import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  AgentDefinition,
  ProviderConfig,
  UnifiedStore,
  ApiKeyRecord,
  Connection,
  ConnectionKind,
  Message,
  SessionSummary,
  ContextEntry,
  EvalSuite,
  EvalSuiteRun,
  InvocationLog,
  LogFilter,
} from "../types.js";

interface AgentVersion {
  agent: AgentDefinition;
  createdAt: string;
  activatedAt: string | null;
}

interface SessionRow {
  userId: string;
  agentId?: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
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
 * Shared backing state across MemoryStore instances created via forUser().
 */
interface MemoryBackend {
  agentVersions: Map<string, Map<string, AgentVersion[]>>; // userId -> agentId -> versions
  sessions: Map<string, SessionRow>;                        // sessionId -> row (row carries userId)
  contexts: Map<string, { userId: string; entries: ContextEntry[] }>;
  logs: Array<{ userId: string; log: InvocationLog }>;
  evalSuites: Map<string, Map<string, EvalSuite>>;         // userId -> suiteId -> suite
  evalRuns: Map<string, Map<string, EvalSuiteRun>>;        // userId -> runId -> run
  providers: Map<string, Map<string, ProviderConfig>>;      // userId -> providerId -> config
  connections: Map<string, Map<string, Connection>>;        // userId -> `${kind}:${id}` -> connection
  apiKeys: Map<string, ApiKeyRow>;                          // id -> row
  apiKeyByHash: Map<string, ApiKeyRow>;                     // sha256(rawKey) -> row
}

function createBackend(): MemoryBackend {
  return {
    agentVersions: new Map(),
    sessions: new Map(),
    contexts: new Map(),
    logs: [],
    evalSuites: new Map(),
    evalRuns: new Map(),
    providers: new Map(),
    connections: new Map(),
    apiKeys: new Map(),
    apiKeyByHash: new Map(),
  };
}

/**
 * MemoryStore is the default store for quick-start / test usage. Unlike
 * PostgresStore / SqliteStore, it auto-scopes to a "__default__" user when
 * constructed without explicit userId so tests and single-user demos don't
 * need forUser() ceremony. Multi-user callers still use forUser() as normal.
 */
const DEFAULT_USER_ID = "__default__";

export class MemoryStore implements UnifiedStore {
  private backend: MemoryBackend;
  readonly userId: string | null;
  private lastTs = 0;

  constructor(opts: { userId?: string; backend?: MemoryBackend; strict?: boolean } = {}) {
    this.backend = opts.backend ?? createBackend();
    if (opts.userId !== undefined) {
      this.userId = opts.userId;
    } else if (opts.strict) {
      this.userId = null;
    } else {
      this.userId = DEFAULT_USER_ID;
    }
  }

  forUser(userId: string): MemoryStore {
    return new MemoryStore({ userId, backend: this.backend });
  }

  private requireUser(): string {
    if (!this.userId) {
      throw new Error("MemoryStore: user not set. Call forUser(id) first.");
    }
    return this.userId;
  }

  private nextTimestamp(): string {
    const now = Date.now();
    const next = now > this.lastTs ? now : this.lastTs + 1;
    this.lastTs = next;
    return new Date(next).toISOString();
  }

  // ═══ AgentStore ═══

  private agentMap(): Map<string, AgentVersion[]> {
    const u = this.requireUser();
    let m = this.backend.agentVersions.get(u);
    if (!m) {
      m = new Map();
      this.backend.agentVersions.set(u, m);
    }
    return m;
  }

  async getAgent(id: string): Promise<AgentDefinition | null> {
    const versions = this.agentMap().get(id);
    if (!versions || versions.length === 0) return null;
    const active = versions
      .filter((v) => v.activatedAt !== null)
      .sort((a, b) => b.activatedAt!.localeCompare(a.activatedAt!));
    if (active.length > 0) return active[0].agent;
    return versions[versions.length - 1].agent;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    const result: Array<{ id: string; name: string; description?: string }> = [];
    for (const [id] of this.agentMap()) {
      const agent = await this.getAgent(id);
      if (agent) {
        result.push({ id: agent.id, name: agent.name, description: agent.description });
      }
    }
    return result;
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    const map = this.agentMap();
    const now = this.nextTimestamp();
    const versions = map.get(agent.id) ?? [];
    versions.push({
      agent: { ...agent, createdAt: now, updatedAt: now },
      createdAt: now,
      activatedAt: now,
    });
    map.set(agent.id, versions);
  }

  async deleteAgent(id: string): Promise<void> {
    this.agentMap().delete(id);
  }

  async listAgentVersions(agentId: string): Promise<Array<{ createdAt: string; activatedAt: string | null }>> {
    const versions = this.agentMap().get(agentId) ?? [];
    return versions
      .map((v) => ({ createdAt: v.createdAt, activatedAt: v.activatedAt }))
      .reverse();
  }

  async getAgentVersion(agentId: string, createdAt: string): Promise<AgentDefinition | null> {
    const versions = this.agentMap().get(agentId) ?? [];
    const found = versions.find((v) => v.createdAt === createdAt);
    return found?.agent ?? null;
  }

  async activateAgentVersion(agentId: string, createdAt: string): Promise<void> {
    const versions = this.agentMap().get(agentId) ?? [];
    const found = versions.find((v) => v.createdAt === createdAt);
    if (found) {
      found.activatedAt = this.nextTimestamp();
    }
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    const u = this.requireUser();
    const session = this.backend.sessions.get(sessionId);
    if (!session || session.userId !== u) return [];
    return session.messages;
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    const u = this.requireUser();
    const now = new Date().toISOString();
    const session = this.backend.sessions.get(sessionId);
    if (session) {
      if (session.userId !== u) {
        throw new Error(`Session ${sessionId} belongs to a different user`);
      }
      session.messages.push(...messages);
      session.updatedAt = now;
    } else {
      this.backend.sessions.set(sessionId, {
        userId: u,
        messages: [...messages],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const u = this.requireUser();
    const session = this.backend.sessions.get(sessionId);
    if (session && session.userId === u) {
      this.backend.sessions.delete(sessionId);
    }
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    const u = this.requireUser();
    const result: SessionSummary[] = [];
    for (const [sessionId, session] of this.backend.sessions) {
      if (session.userId !== u) continue;
      if (agentId && session.agentId !== agentId) continue;
      result.push({
        sessionId,
        agentId: session.agentId,
        messageCount: session.messages.length,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }
    return result;
  }

  // ═══ ContextStore ═══

  async getContext(contextId: string): Promise<ContextEntry[]> {
    const u = this.requireUser();
    const ctx = this.backend.contexts.get(contextId);
    if (!ctx || ctx.userId !== u) return [];
    return ctx.entries;
  }

  async addContext(contextId: string, entry: ContextEntry): Promise<void> {
    const u = this.requireUser();
    const existing = this.backend.contexts.get(contextId);
    if (existing) {
      if (existing.userId !== u) {
        throw new Error(`Context ${contextId} belongs to a different user`);
      }
      existing.entries.push(entry);
    } else {
      this.backend.contexts.set(contextId, { userId: u, entries: [entry] });
    }
  }

  async clearContext(contextId: string): Promise<void> {
    const u = this.requireUser();
    const existing = this.backend.contexts.get(contextId);
    if (existing && existing.userId === u) {
      this.backend.contexts.delete(contextId);
    }
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    const u = this.requireUser();
    this.backend.logs.push({ userId: u, log: entry });
  }

  async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
    const u = this.requireUser();
    let result = this.backend.logs.filter((r) => r.userId === u).map((r) => r.log);

    if (filter?.agentId) result = result.filter((l) => l.agentId === filter.agentId);
    if (filter?.sessionId) result = result.filter((l) => l.sessionId === filter.sessionId);
    if (filter?.since) result = result.filter((l) => l.timestamp >= filter.since!);

    result.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.offset) result = result.slice(filter.offset);
    if (filter?.limit) result = result.slice(0, filter.limit);

    return result;
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    const u = this.requireUser();
    const found = this.backend.logs.find((r) => r.userId === u && r.log.id === id);
    return found?.log ?? null;
  }

  // ═══ EvalSuiteStore ═══

  private evalSuiteMap(): Map<string, EvalSuite> {
    const u = this.requireUser();
    let m = this.backend.evalSuites.get(u);
    if (!m) {
      m = new Map();
      this.backend.evalSuites.set(u, m);
    }
    return m;
  }

  private evalRunMap(): Map<string, EvalSuiteRun> {
    const u = this.requireUser();
    let m = this.backend.evalRuns.get(u);
    if (!m) {
      m = new Map();
      this.backend.evalRuns.set(u, m);
    }
    return m;
  }

  async putEvalSuite(suite: EvalSuite): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.evalSuiteMap().get(suite.id);
    this.evalSuiteMap().set(suite.id, cloneJson({
      ...suite,
      createdAt: existing?.createdAt ?? suite.createdAt ?? now,
      updatedAt: now,
    }));
  }

  async getEvalSuite(id: string): Promise<EvalSuite | null> {
    const suite = this.evalSuiteMap().get(id);
    return suite ? cloneJson(suite) : null;
  }

  async listEvalSuites(agentId?: string): Promise<EvalSuite[]> {
    return Array.from(this.evalSuiteMap().values())
      .filter((suite) => !agentId || suite.agentId === agentId)
      .map(cloneJson)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteEvalSuite(id: string): Promise<void> {
    this.evalSuiteMap().delete(id);
  }

  async putEvalSuiteRun(run: EvalSuiteRun): Promise<void> {
    this.evalRunMap().set(run.id, cloneJson(run));
  }

  async getEvalSuiteRun(id: string): Promise<EvalSuiteRun | null> {
    const run = this.evalRunMap().get(id);
    return run ? cloneJson(run) : null;
  }

  async listEvalSuiteRuns(suiteId: string): Promise<EvalSuiteRun[]> {
    return Array.from(this.evalRunMap().values())
      .filter((run) => run.suiteId === suiteId)
      .map(cloneJson)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  // ═══ ProviderStore ═══

  private providerMap(): Map<string, ProviderConfig> {
    const u = this.requireUser();
    let m = this.backend.providers.get(u);
    if (!m) {
      m = new Map();
      this.backend.providers.set(u, m);
    }
    return m;
  }

  async getProvider(id: string): Promise<ProviderConfig | null> {
    return this.providerMap().get(id) ?? null;
  }

  async listProviders(): Promise<Array<{ id: string; configured: boolean }>> {
    return Array.from(this.providerMap().values()).map((p) => ({
      id: p.id,
      configured: !!p.apiKey,
    }));
  }

  async putProvider(provider: ProviderConfig): Promise<void> {
    this.providerMap().set(provider.id, { ...provider, updatedAt: new Date().toISOString() });
  }

  async deleteProvider(id: string): Promise<void> {
    this.providerMap().delete(id);
  }

  // ═══ ConnectionStore ═══

  private connectionMap(): Map<string, Connection> {
    const u = this.requireUser();
    let m = this.backend.connections.get(u);
    if (!m) {
      m = new Map();
      this.backend.connections.set(u, m);
    }
    return m;
  }

  async getConnection(kind: ConnectionKind, id: string): Promise<Connection | null> {
    return this.connectionMap().get(`${kind}:${id}`) ?? null;
  }

  async listConnections(kind?: ConnectionKind): Promise<Connection[]> {
    const all = Array.from(this.connectionMap().values());
    const filtered = kind ? all.filter((c) => c.kind === kind) : all;
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  async putConnection(connection: Connection): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.connectionMap().get(`${connection.kind}:${connection.id}`);
    this.connectionMap().set(`${connection.kind}:${connection.id}`, {
      ...connection,
      createdAt: existing?.createdAt ?? connection.createdAt ?? now,
      updatedAt: now,
    });
  }

  async deleteConnection(kind: ConnectionKind, id: string): Promise<void> {
    this.connectionMap().delete(`${kind}:${id}`);
  }

  // ═══ ApiKeyStore (unscoped admin) ═══

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
    this.backend.apiKeys.set(row.id, row);
    this.backend.apiKeyByHash.set(keyHash, row);
    return { record: rowToRecord(row), rawKey };
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    return Array.from(this.backend.apiKeys.values())
      .filter((r) => r.userId === userId)
      .map(rowToRecord)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
    const row = this.backend.apiKeys.get(params.keyId);
    if (!row || row.userId !== params.userId) return;
    row.revokedAt = new Date().toISOString();
  }

  async resolveApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const row = this.backend.apiKeyByHash.get(keyHash);
    if (!row || row.revokedAt) return null;
    row.lastUsedAt = new Date().toISOString();
    return { userId: row.userId, keyId: row.id };
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

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
