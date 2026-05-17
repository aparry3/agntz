import { readFile, writeFile, mkdir, readdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { listRunsInProcess } from "./list-runs.js";
import { defineSkill } from "../skill.js";
import {
  encryptSecret,
  decryptSecret,
  getLastFour,
} from "../utils/crypto.js";
import type {
  AgentDefinition,
  AgentVersionSummary,
  ProviderConfig,
  SecretDefinition,
  SecretMetadata,
  SkillDefinition,
  UnifiedStore,
  ApiKeyRecord,
  Connection,
  ConnectionKind,
  Message,
  SessionSummary,
  ContextEntry,
  InvocationLog,
  LogFilter,
  Run,
  RunListFilters,
  RunListResult,
  Span,
  TraceSummary,
  TraceFilter,
  WebhookDelivery,
} from "../types.js";
import { encodeTraceCursor, decodeTraceCursor } from "./memory.js";

interface StoredAgentVersion {
  agent: AgentDefinition;
  createdAt: string;
  activatedAt: string | null;
}

interface ApiKeyRow {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * JSON file store. User-scoped data lives under
 *   basePath/users/<userId>/{agents,sessions,context,logs,providers}/
 * API key registry is a top-level JSON file.
 */
export class JsonFileStore implements UnifiedStore {
  private basePath: string;
  readonly userId: string | null;
  private lastTs = 0;

  constructor(basePath: string, userId?: string) {
    this.basePath = basePath;
    this.userId = userId ?? null;
  }

  forUser(userId: string): JsonFileStore {
    return new JsonFileStore(this.basePath, userId);
  }

  private requireUser(): string {
    if (!this.userId) {
      throw new Error("JsonFileStore: user not set. Call forUser(id) first.");
    }
    return this.userId;
  }

  private nextTimestamp(): string {
    const now = Date.now();
    const next = now > this.lastTs ? now : this.lastTs + 1;
    this.lastTs = next;
    return new Date(next).toISOString();
  }

  private userRoot(): string {
    return join(this.basePath, "users", this.sanitizeFilename(this.requireUser()));
  }

  private async ensureUserDirs(): Promise<void> {
    const root = this.userRoot();
    await mkdir(join(root, "agents"), { recursive: true });
    await mkdir(join(root, "sessions"), { recursive: true });
    await mkdir(join(root, "context"), { recursive: true });
    await mkdir(join(root, "logs"), { recursive: true });
    await mkdir(join(root, "providers"), { recursive: true });
    await mkdir(join(root, "connections"), { recursive: true });
    await mkdir(join(root, "runs"), { recursive: true });
    await mkdir(join(root, "skills"), { recursive: true });
    await mkdir(join(root, "secrets"), { recursive: true });
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      const data = await readFile(path, "utf-8");
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
  }

  private sanitizeFilename(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private filenameSafeTimestamp(ts: string): string {
    return ts.replace(/:/g, "-");
  }

  // ═══ AgentStore ═══

  private agentDir(id: string): string {
    return join(this.userRoot(), "agents", this.sanitizeFilename(id));
  }

  private async readAllVersions(agentId: string): Promise<StoredAgentVersion[]> {
    const dir = this.agentDir(agentId);
    const files = await readdir(dir).catch(() => []);
    const versions: StoredAgentVersion[] = [];
    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("_")) continue;
      const v = await this.readJson<StoredAgentVersion>(join(dir, file));
      if (v) versions.push(v);
    }
    return versions;
  }

  async getAgent(id: string): Promise<AgentDefinition | null> {
    await this.ensureUserDirs();
    const versions = await this.readAllVersions(id);
    if (versions.length === 0) return null;
    const active = versions.filter((v) => v.activatedAt !== null);
    if (active.length > 0) {
      active.sort((a, b) => b.activatedAt!.localeCompare(a.activatedAt!));
      return active[0].agent;
    }
    versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return versions[0].agent;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    await this.ensureUserDirs();
    const root = join(this.userRoot(), "agents");
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const agents: Array<{ id: string; name: string; description?: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agent = await this.getAgent(entry.name);
      if (agent) {
        agents.push({ id: agent.id, name: agent.name, description: agent.description });
      }
    }

    return agents.sort((a, b) => a.name.localeCompare(b.name));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    await this.ensureUserDirs();
    const dir = this.agentDir(agent.id);
    await mkdir(dir, { recursive: true });
    const now = this.nextTimestamp();
    const stored: StoredAgentVersion = {
      agent: { ...agent, createdAt: now, updatedAt: now },
      createdAt: now,
      activatedAt: now,
    };
    await this.writeJson(join(dir, `${this.filenameSafeTimestamp(now)}.json`), stored);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.ensureUserDirs();
    await rm(this.agentDir(id), { recursive: true, force: true });
  }

  private aliasFilePath(agentId: string): string {
    return join(this.agentDir(agentId), "_aliases.json");
  }

  private async readAliases(agentId: string): Promise<Record<string, string>> {
    return (await this.readJson<Record<string, string>>(this.aliasFilePath(agentId))) ?? {};
  }

  async listAgentVersions(agentId: string): Promise<AgentVersionSummary[]> {
    await this.ensureUserDirs();
    const versions = await this.readAllVersions(agentId);
    const aliases = await this.readAliases(agentId);
    const byVersion = new Map<string, string[]>();
    for (const [alias, createdAt] of Object.entries(aliases)) {
      const list = byVersion.get(createdAt) ?? [];
      list.push(alias);
      byVersion.set(createdAt, list);
    }
    return versions
      .map((v) => ({
        createdAt: v.createdAt,
        activatedAt: v.activatedAt,
        aliases: (byVersion.get(v.createdAt) ?? []).sort(),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getAgentVersion(agentId: string, createdAt: string): Promise<AgentDefinition | null> {
    await this.ensureUserDirs();
    const path = join(this.agentDir(agentId), `${this.filenameSafeTimestamp(createdAt)}.json`);
    const v = await this.readJson<StoredAgentVersion>(path);
    return v?.agent ?? null;
  }

  async activateAgentVersion(agentId: string, createdAt: string): Promise<void> {
    await this.ensureUserDirs();
    const path = join(this.agentDir(agentId), `${this.filenameSafeTimestamp(createdAt)}.json`);
    const v = await this.readJson<StoredAgentVersion>(path);
    if (!v) return;
    v.activatedAt = this.nextTimestamp();
    await this.writeJson(path, v);
  }

  async resolveAgentAlias(agentId: string, alias: string): Promise<string | null> {
    const aliases = await this.readAliases(agentId);
    return aliases[alias] ?? null;
  }

  async setAgentVersionAlias(agentId: string, createdAt: string, alias: string): Promise<void> {
    await this.ensureUserDirs();
    const versionFile = join(this.agentDir(agentId), `${this.filenameSafeTimestamp(createdAt)}.json`);
    const v = await this.readJson<StoredAgentVersion>(versionFile);
    if (!v) throw new Error(`Agent version not found: ${agentId}@${createdAt}`);
    const aliases = await this.readAliases(agentId);
    aliases[alias] = createdAt;
    await this.writeJson(this.aliasFilePath(agentId), aliases);
  }

  async removeAgentVersionAlias(agentId: string, alias: string): Promise<void> {
    await this.ensureUserDirs();
    const aliases = await this.readAliases(agentId);
    if (!(alias in aliases)) return;
    delete aliases[alias];
    await this.writeJson(this.aliasFilePath(agentId), aliases);
  }

  // ═══ SessionStore ═══

  private sessionPath(sessionId: string): string {
    return join(this.userRoot(), "sessions", `${this.sanitizeFilename(sessionId)}.json`);
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    await this.ensureUserDirs();
    const data = await this.readJson<{ messages: Message[] }>(this.sessionPath(sessionId));
    return data?.messages ?? [];
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureUserDirs();
    const path = this.sessionPath(sessionId);
    const existing = await this.readJson<{ messages: Message[]; createdAt: string }>(path);
    const now = new Date().toISOString();

    await this.writeJson(path, {
      sessionId,
      messages: [...(existing?.messages ?? []), ...messages],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureUserDirs();
    await unlink(this.sessionPath(sessionId)).catch(() => {});
  }

  async getOrCreateSession(sessionId: string): Promise<void> {
    await this.ensureUserDirs();
    const path = this.sessionPath(sessionId);
    const existing = await this.readJson<{ messages: Message[]; createdAt: string }>(path);
    if (existing) return;
    const now = new Date().toISOString();
    await this.writeJson(path, {
      sessionId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  async listSessions(_agentId?: string): Promise<SessionSummary[]> {
    await this.ensureUserDirs();
    const dir = join(this.userRoot(), "sessions");
    const files = await readdir(dir).catch(() => []);
    const sessions: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const data = await this.readJson<{
        sessionId: string;
        messages: Message[];
        createdAt: string;
        updatedAt: string;
      }>(join(dir, file));
      if (data) {
        sessions.push({
          sessionId: data.sessionId,
          messageCount: data.messages?.length ?? 0,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      }
    }

    return sessions;
  }

  // ═══ ContextStore ═══

  private contextPath(contextId: string): string {
    return join(this.userRoot(), "context", `${this.sanitizeFilename(contextId)}.json`);
  }

  async getContext(contextId: string): Promise<ContextEntry[]> {
    await this.ensureUserDirs();
    const data = await this.readJson<{ entries: ContextEntry[] }>(this.contextPath(contextId));
    return data?.entries ?? [];
  }

  async addContext(contextId: string, entry: ContextEntry): Promise<void> {
    await this.ensureUserDirs();
    const path = this.contextPath(contextId);
    const existing = await this.readJson<{ entries: ContextEntry[] }>(path);
    const entries = [...(existing?.entries ?? []), entry];
    await this.writeJson(path, { contextId, entries });
  }

  async clearContext(contextId: string): Promise<void> {
    await this.ensureUserDirs();
    await unlink(this.contextPath(contextId)).catch(() => {});
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    await this.ensureUserDirs();
    await this.writeJson(
      join(this.userRoot(), "logs", `${this.sanitizeFilename(entry.id)}.json`),
      entry
    );
  }

  async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
    await this.ensureUserDirs();
    const dir = join(this.userRoot(), "logs");
    const files = await readdir(dir).catch(() => []);
    let logs: InvocationLog[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const log = await this.readJson<InvocationLog>(join(dir, file));
      if (log) logs.push(log);
    }

    if (filter?.agentId) logs = logs.filter((l) => l.agentId === filter.agentId);
    if (filter?.sessionId) logs = logs.filter((l) => l.sessionId === filter.sessionId);
    if (filter?.since) logs = logs.filter((l) => l.timestamp >= filter.since!);

    logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.offset) logs = logs.slice(filter.offset);
    if (filter?.limit) logs = logs.slice(0, filter.limit);

    return logs;
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    await this.ensureUserDirs();
    return this.readJson<InvocationLog>(
      join(this.userRoot(), "logs", `${this.sanitizeFilename(id)}.json`)
    );
  }

  // ═══ ProviderStore ═══

  private providerPath(id: string): string {
    return join(this.userRoot(), "providers", `${this.sanitizeFilename(id)}.json`);
  }

  async getProvider(id: string): Promise<ProviderConfig | null> {
    await this.ensureUserDirs();
    return this.readJson<ProviderConfig>(this.providerPath(id));
  }

  async listProviders(): Promise<Array<{ id: string; configured: boolean }>> {
    await this.ensureUserDirs();
    const dir = join(this.userRoot(), "providers");
    const files = await readdir(dir).catch(() => []);
    const result: Array<{ id: string; configured: boolean }> = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const provider = await this.readJson<ProviderConfig>(join(dir, file));
      if (provider) {
        result.push({ id: provider.id, configured: !!provider.apiKey });
      }
    }
    return result;
  }

  async putProvider(provider: ProviderConfig): Promise<void> {
    await this.ensureUserDirs();
    await this.writeJson(this.providerPath(provider.id), {
      ...provider,
      updatedAt: new Date().toISOString(),
    });
  }

  async deleteProvider(id: string): Promise<void> {
    await this.ensureUserDirs();
    await unlink(this.providerPath(id)).catch(() => {});
  }

  // ═══ ConnectionStore ═══

  private connectionPath(kind: ConnectionKind, id: string): string {
    return join(
      this.userRoot(),
      "connections",
      `${this.sanitizeFilename(kind)}__${this.sanitizeFilename(id)}.json`,
    );
  }

  async getConnection(kind: ConnectionKind, id: string): Promise<Connection | null> {
    await this.ensureUserDirs();
    return this.readJson<Connection>(this.connectionPath(kind, id));
  }

  async listConnections(kind?: ConnectionKind): Promise<Connection[]> {
    await this.ensureUserDirs();
    const dir = join(this.userRoot(), "connections");
    const files = await readdir(dir).catch(() => []);
    const result: Connection[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const c = await this.readJson<Connection>(join(dir, file));
      if (c && (!kind || c.kind === kind)) result.push(c);
    }
    result.sort((a, b) => (a.kind + a.id).localeCompare(b.kind + b.id));
    return result;
  }

  async putConnection(connection: Connection): Promise<void> {
    await this.ensureUserDirs();
    const existing = await this.readJson<Connection>(
      this.connectionPath(connection.kind, connection.id),
    );
    const now = new Date().toISOString();
    await this.writeJson(this.connectionPath(connection.kind, connection.id), {
      ...connection,
      createdAt: existing?.createdAt ?? connection.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteConnection(kind: ConnectionKind, id: string): Promise<void> {
    await this.ensureUserDirs();
    await unlink(this.connectionPath(kind, id)).catch(() => {});
  }

  // ═══ SkillStore ═══

  private skillPath(name: string): string {
    return join(this.userRoot(), "skills", `${this.sanitizeFilename(name)}.json`);
  }

  async getSkill(name: string): Promise<SkillDefinition | null> {
    await this.ensureUserDirs();
    return this.readJson<SkillDefinition>(this.skillPath(name));
  }

  async listSkills(): Promise<Array<{ name: string; description: string }>> {
    await this.ensureUserDirs();
    const dir = join(this.userRoot(), "skills");
    const files = await readdir(dir).catch(() => []);
    const result: Array<{ name: string; description: string }> = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const s = await this.readJson<SkillDefinition>(join(dir, file));
      if (s) result.push({ name: s.name, description: s.description });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async putSkill(skill: SkillDefinition): Promise<void> {
    const validated = defineSkill(skill);
    await this.ensureUserDirs();
    const path = this.skillPath(validated.name);
    const existing = await this.readJson<SkillDefinition>(path);
    const now = this.nextTimestamp();
    await this.writeJson(path, {
      ...validated,
      createdAt: existing?.createdAt ?? validated.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteSkill(name: string): Promise<void> {
    await this.ensureUserDirs();
    await unlink(this.skillPath(name)).catch(() => {});
  }

  // ═══ SecretStore ═══

  private secretPath(name: string): string {
    return join(this.userRoot(), "secrets", `${this.sanitizeFilename(name)}.json`);
  }

  async listSecrets(): Promise<SecretMetadata[]> {
    await this.ensureUserDirs();
    const dir = join(this.userRoot(), "secrets");
    const files = await readdir(dir).catch(() => []);
    const result: SecretMetadata[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const row = await this.readJson<{
        name: string;
        encrypted: string;
        lastFour: string;
        description?: string;
        createdAt: string;
        updatedAt: string;
      }>(join(dir, file));
      if (!row) continue;
      result.push({
        name: row.name,
        lastFour: row.lastFour,
        description: row.description,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSecretMetadata(name: string): Promise<SecretMetadata | null> {
    await this.ensureUserDirs();
    const row = await this.readJson<{
      name: string;
      lastFour: string;
      description?: string;
      createdAt: string;
      updatedAt: string;
    }>(this.secretPath(name));
    if (!row) return null;
    return {
      name: row.name,
      lastFour: row.lastFour,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async getSecretValue(name: string): Promise<string | null> {
    await this.ensureUserDirs();
    const row = await this.readJson<{ encrypted: string }>(this.secretPath(name));
    if (!row) return null;
    return decryptSecret(row.encrypted);
  }

  async putSecret(secret: SecretDefinition): Promise<void> {
    if (!secret.name) {
      throw new Error("putSecret: name is required");
    }
    if (secret.value === undefined || secret.value === null) {
      throw new Error("putSecret: value is required");
    }
    await this.ensureUserDirs();
    const path = this.secretPath(secret.name);
    const existing = await this.readJson<{ createdAt?: string }>(path);
    const now = this.nextTimestamp();
    await this.writeJson(path, {
      name: secret.name,
      encrypted: encryptSecret(secret.value),
      lastFour: getLastFour(secret.value),
      description: secret.description,
      createdAt: existing?.createdAt ?? secret.createdAt ?? now,
      updatedAt: now,
    });
  }

  async updateSecretDescription(
    name: string,
    description: string | undefined,
  ): Promise<boolean> {
    await this.ensureUserDirs();
    const path = this.secretPath(name);
    const existing = await this.readJson<{
      name: string;
      encrypted: string;
      lastFour: string;
      description?: string;
      createdAt: string;
      updatedAt: string;
    }>(path);
    if (!existing) return false;
    const now = this.nextTimestamp();
    await this.writeJson(path, {
      ...existing,
      description,
      updatedAt: now,
    });
    return true;
  }

  async deleteSecret(name: string): Promise<void> {
    await this.ensureUserDirs();
    await unlink(this.secretPath(name)).catch(() => {});
  }

  // ═══ RunStore ═══
  // Runs live under basePath/users/<userId>/runs/<runId>.json

  private runPath(runId: string): string {
    return join(this.userRoot(), "runs", `${this.sanitizeFilename(runId)}.json`);
  }

  async putRun(run: Run): Promise<void> {
    await this.ensureUserDirs();
    await this.writeJson(this.runPath(run.id), run);
  }

  async getRun(runId: string): Promise<Run | null> {
    return this.readJson<Run>(this.runPath(runId));
  }

  async listChildren(parentRunId: string): Promise<Run[]> {
    this.requireUser();
    const runsDir = join(this.userRoot(), "runs");
    let files: string[];
    try {
      files = await readdir(runsDir);
    } catch {
      return [];
    }
    const results: Run[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const run = await this.readJson<Run>(join(runsDir, f));
      if (run && run.parentId === parentRunId) results.push(run);
    }
    return results.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }

  async listSubtree(rootId: string): Promise<Run[]> {
    this.requireUser();
    const runsDir = join(this.userRoot(), "runs");
    let files: string[];
    try {
      files = await readdir(runsDir);
    } catch {
      return [];
    }
    const allRuns: Run[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const run = await this.readJson<Run>(join(runsDir, f));
      if (run) allRuns.push(run);
    }
    const byId = new Map(allRuns.map((r) => [r.id, r]));
    const result: Run[] = [];
    const visited = new Set<string>();
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const run = byId.get(id);
      if (run) {
        result.push(run);
        for (const r of allRuns) {
          if (r.parentId === id && !visited.has(r.id)) queue.push(r.id);
        }
      }
    }
    return result.sort((a, b) => a.depth - b.depth || a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }

  async listRuns(filters: RunListFilters): Promise<RunListResult> {
    this.requireUser();
    const runsDir = join(this.userRoot(), "runs");
    let files: string[];
    try {
      files = await readdir(runsDir);
    } catch {
      return { rows: [] };
    }
    const allRuns: Run[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const run = await this.readJson<Run>(join(runsDir, f));
      if (run) allRuns.push(run);
    }
    return listRunsInProcess(allRuns, filters);
  }

  // ═══ TraceStore ═══
  // Spans and summaries live under basePath/traces/{spans,summaries}/.
  // Methods take explicit ownerId params — no forUser() scoping needed.
  // Shallow-copy contract: callers must not mutate attributes/events/scores
  // after the span crosses the store boundary.

  private spanPath(spanId: string): string {
    return join(this.basePath, "traces", "spans", `${this.sanitizeFilename(spanId)}.json`);
  }

  private summaryPath(traceId: string): string {
    return join(this.basePath, "traces", "summaries", `${this.sanitizeFilename(traceId)}.json`);
  }

  private async ensureTraceDirs(): Promise<void> {
    await mkdir(join(this.basePath, "traces", "spans"), { recursive: true });
    await mkdir(join(this.basePath, "traces", "summaries"), { recursive: true });
  }

  async insertSpan(span: Span): Promise<void> {
    await this.ensureTraceDirs();
    await this.writeJson(this.spanPath(span.spanId), { ...span });
  }

  async insertSpansBatch(spans: Span[]): Promise<void> {
    await this.ensureTraceDirs();
    await Promise.all(spans.map((s) => this.writeJson(this.spanPath(s.spanId), { ...s })));
  }

  async updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void> {
    await this.ensureTraceDirs();
    const existing = await this.readJson<Span>(this.spanPath(spanId));
    if (!existing || existing.ownerId !== ownerId) return;
    await this.writeJson(this.spanPath(spanId), { ...existing, ...patch, spanId, ownerId });
  }

  async upsertSummary(summary: TraceSummary): Promise<void> {
    await this.ensureTraceDirs();
    await this.writeJson(this.summaryPath(summary.traceId), { ...summary });
  }

  // O(total_spans across all traces) — JsonFileStore stores spans in a flat
  // directory; backends with per-trace indexes (sqlite, postgres) are O(spans in trace).
  async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
    const spansDir = join(this.basePath, "traces", "spans");
    const files = await readdir(spansDir).catch(() => []);
    const out: Span[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const s = await this.readJson<Span>(join(spansDir, file));
      if (s && s.traceId === traceId && s.ownerId === ownerId) out.push({ ...s });
    }
    return out.sort(
      (a, b) => a.startedAt.localeCompare(b.startedAt) || a.spanId.localeCompare(b.spanId)
    );
  }

  async getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null> {
    const s = await this.readJson<TraceSummary>(this.summaryPath(traceId));
    if (!s || s.ownerId !== ownerId) return null;
    return { ...s };
  }

  async listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const summariesDir = join(this.basePath, "traces", "summaries");
    const files = await readdir(summariesDir).catch(() => []);
    const all: TraceSummary[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const s = await this.readJson<TraceSummary>(join(summariesDir, file));
      if (!s) continue;
      if (s.ownerId !== filter.ownerId) continue;
      if (filter.agentId && s.agentId !== filter.agentId) continue;
      if (filter.status && s.status !== filter.status) continue;
      if (filter.startedAfter && s.startedAt < filter.startedAfter) continue;
      if (filter.startedBefore && s.startedAt > filter.startedBefore) continue;
      all.push({ ...s });
    }
    all.sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt) || b.traceId.localeCompare(a.traceId)
    );

    let startIdx = 0;
    if (filter.cursor) {
      const decoded = decodeTraceCursor(filter.cursor);
      if (decoded) {
        startIdx = all.findIndex(
          (r) =>
            r.startedAt < decoded.startedAt ||
            (r.startedAt === decoded.startedAt && r.traceId < decoded.traceId)
        );
        if (startIdx === -1) startIdx = all.length;
      }
    }

    const rows = all.slice(startIdx, startIdx + limit);
    const cursor =
      rows.length === limit && startIdx + limit < all.length
        ? encodeTraceCursor({
            startedAt: rows[rows.length - 1].startedAt,
            traceId: rows[rows.length - 1].traceId,
          })
        : undefined;
    return { rows, cursor };
  }

  async deleteTrace(traceId: string, ownerId: string): Promise<void> {
    const summary = await this.readJson<TraceSummary>(this.summaryPath(traceId));
    if (summary && summary.ownerId !== ownerId) return;
    await unlink(this.summaryPath(traceId)).catch(() => {});
    const spansDir = join(this.basePath, "traces", "spans");
    const files = await readdir(spansDir).catch(() => []);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const s = await this.readJson<Span>(join(spansDir, file));
      if (s && s.traceId === traceId && s.ownerId === ownerId) {
        await unlink(join(spansDir, file)).catch(() => {});
      }
    }
  }

  async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
    const beforeIso = before.toISOString();
    const summariesDir = join(this.basePath, "traces", "summaries");
    const files = await readdir(summariesDir).catch(() => []);
    const toDelete: string[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const s = await this.readJson<TraceSummary>(join(summariesDir, file));
      if (s && s.ownerId === ownerId && s.startedAt < beforeIso) toDelete.push(s.traceId);
    }
    const spansDir = join(this.basePath, "traces", "spans");
    const spanFiles = await readdir(spansDir).catch(() => []);
    for (const traceId of toDelete) {
      await unlink(this.summaryPath(traceId)).catch(() => {});
      for (const file of spanFiles) {
        if (!file.endsWith(".json")) continue;
        const s = await this.readJson<Span>(join(spansDir, file));
        if (s && s.traceId === traceId && s.ownerId === ownerId) {
          await unlink(join(spansDir, file)).catch(() => {});
        }
      }
    }
    return toDelete.length;
  }

  // ═══ ApiKeyStore (unscoped) ═══

  private apiKeysPath(): string {
    return join(this.basePath, "api-keys.json");
  }

  private async readApiKeys(): Promise<ApiKeyRow[]> {
    return (await this.readJson<ApiKeyRow[]>(this.apiKeysPath())) ?? [];
  }

  private async writeApiKeys(rows: ApiKeyRow[]): Promise<void> {
    await mkdir(this.basePath, { recursive: true });
    await this.writeJson(this.apiKeysPath(), rows);
  }

  async createApiKey(params: { userId: string; name: string }): Promise<{ record: ApiKeyRecord; rawKey: string }> {
    const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
    const keyPrefix = rawKey.slice(0, 14);
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const row: ApiKeyRow = {
      id: randomUUID(),
      userId: params.userId,
      name: params.name,
      keyPrefix,
      keyHash,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    const rows = await this.readApiKeys();
    rows.push(row);
    await this.writeApiKeys(rows);
    return { record: rowToRecord(row), rawKey };
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    const rows = await this.readApiKeys();
    return rows
      .filter((r) => r.userId === userId)
      .map(rowToRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
    const rows = await this.readApiKeys();
    const row = rows.find((r) => r.id === params.keyId && r.userId === params.userId);
    if (!row) return;
    row.revokedAt = new Date().toISOString();
    await this.writeApiKeys(rows);
  }

  async resolveApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const rows = await this.readApiKeys();
    const row = rows.find((r) => r.keyHash === keyHash && !r.revokedAt);
    if (!row) return null;
    row.lastUsedAt = new Date().toISOString();
    await this.writeApiKeys(rows);
    return { userId: row.userId, keyId: row.id };
  }

  // ═══ WebhookDeliveryStore ═══

  private webhookDeliveriesPath(): string {
    return join(this.userRoot(), "webhook-deliveries.json");
  }

  private async readWebhookDeliveries(): Promise<WebhookDelivery[]> {
    return (await this.readJson<WebhookDelivery[]>(this.webhookDeliveriesPath())) ?? [];
  }

  private async writeWebhookDeliveries(rows: WebhookDelivery[]): Promise<void> {
    await mkdir(this.userRoot(), { recursive: true });
    await this.writeJson(this.webhookDeliveriesPath(), rows);
  }

  async insert(
    delivery: Omit<WebhookDelivery, "attempts" | "status" | "createdAt"> & {
      payload: Record<string, unknown>;
    },
  ): Promise<string> {
    this.requireUser();
    const rows = await this.readWebhookDeliveries();
    const now = new Date().toISOString();
    rows.push({
      id: delivery.id,
      runId: delivery.runId,
      callbackUrl: delivery.callbackUrl,
      secretName: delivery.secretName,
      payload: delivery.payload,
      attempts: 0,
      status: "pending",
      createdAt: now,
    });
    await this.writeWebhookDeliveries(rows);
    return delivery.id;
  }

  async updateStatus(
    id: string,
    status: WebhookDelivery["status"],
    lastError?: string,
  ): Promise<void> {
    const rows = await this.readWebhookDeliveries();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    row.status = status;
    if (lastError !== undefined) row.lastError = lastError;
    await this.writeWebhookDeliveries(rows);
  }

  async incrementAttempt(id: string, lastError?: string): Promise<void> {
    const rows = await this.readWebhookDeliveries();
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    row.attempts += 1;
    row.lastAttemptAt = new Date().toISOString();
    if (lastError !== undefined) row.lastError = lastError;
    await this.writeWebhookDeliveries(rows);
  }

  async listPending(filter?: { olderThan?: string; limit?: number }): Promise<WebhookDelivery[]> {
    const rows = await this.readWebhookDeliveries();
    let out = rows.filter((r) => r.status === "pending");
    if (filter?.olderThan) {
      const cutoff = filter.olderThan;
      out = out.filter((r) => r.createdAt < cutoff);
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return filter?.limit ? out.slice(0, filter.limit) : out;
  }
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}
