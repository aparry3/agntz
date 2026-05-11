import { readFile, writeFile, mkdir, readdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AgentDefinition,
  AgentVersionSummary,
  ProviderConfig,
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
} from "../types.js";

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
      if (!file.endsWith(".json")) continue;
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

  async listAgentVersions(agentId: string): Promise<AgentVersionSummary[]> {
    await this.ensureUserDirs();
    const versions = await this.readAllVersions(agentId);
    return versions
      .map((v) => ({ createdAt: v.createdAt, activatedAt: v.activatedAt }))
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

  // ═══ RunStore ═══

  private runsFile(): string {
    return join(this.userRoot(), "runs.json");
  }

  private async readRuns(): Promise<Run[]> {
    try {
      const raw = await readFile(this.runsFile(), "utf-8");
      return JSON.parse(raw) as Run[];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async writeRuns(rows: Run[]): Promise<void> {
    await this.ensureUserDirs();
    await writeFile(this.runsFile(), JSON.stringify(rows, null, 2));
  }

  async putRun(run: Run): Promise<void> {
    const rows = await this.readRuns();
    const idx = rows.findIndex((r) => r.id === run.id);
    if (idx >= 0) rows[idx] = run;
    else rows.push(run);
    await this.writeRuns(rows);
  }

  async getRun(runId: string): Promise<Run | null> {
    const rows = await this.readRuns();
    return rows.find((r) => r.id === runId) ?? null;
  }

  async listChildren(parentRunId: string): Promise<Run[]> {
    const rows = await this.readRuns();
    return rows
      .filter((r) => r.parentId === parentRunId)
      .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  }

  async listSubtree(rootId: string): Promise<Run[]> {
    const rows = await this.readRuns();
    const root = rows.find((r) => r.id === rootId);
    if (!root) return [];
    const byParent = new Map<string, Run[]>();
    for (const r of rows) {
      if (r.parentId) {
        const list = byParent.get(r.parentId) ?? [];
        list.push(r);
        byParent.set(r.parentId, list);
      }
    }
    const out: Run[] = [root];
    const queue: string[] = [rootId];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const kids = byParent.get(id);
      if (!kids) continue;
      for (const k of kids) {
        out.push(k);
        queue.push(k.id);
      }
    }
    return out.sort((a, b) => a.depth - b.depth || a.startedAt - b.startedAt || a.id.localeCompare(b.id));
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
