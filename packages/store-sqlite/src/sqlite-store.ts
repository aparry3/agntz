import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  AgentDefinition,
  ProviderConfig,
  UnifiedStore,
  Workspace,
  ApiKeyRecord,
  Message,
  SessionSummary,
  ContextEntry,
  InvocationLog,
  LogFilter,
} from "@agent-runner/core";

const MIGRATIONS = [
  // v1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    activated_at TEXT,
    PRIMARY KEY (agent_id, created_at)
  );
  CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(agent_id, activated_at);

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    tool_call_id TEXT,
    timestamp TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

  CREATE TABLE IF NOT EXISTS context_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    invocation_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_context_entries_context ON context_entries(context_id);

  CREATE TABLE IF NOT EXISTS invocation_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    tool_calls TEXT NOT NULL DEFAULT '[]',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    error TEXT,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_logs_agent ON invocation_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_logs_session ON invocation_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON invocation_logs(timestamp);

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );
  INSERT INTO schema_version (version) VALUES (1);
  `,
  // v2: Provider configuration
  `
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    base_url TEXT,
    config TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  UPDATE schema_version SET version = 2;
  `,
  // v3: Multi-tenancy. Add workspaces, api keys, workspace_id columns.
  // Existing dev data is wiped (we can't backfill workspace ownership).
  `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    clerk_org_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash_active
    ON api_keys(key_hash) WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_api_keys_workspace ON api_keys(workspace_id);

  -- Wipe and rebuild scoped tables with workspace_id NOT NULL.
  DELETE FROM messages;
  DELETE FROM sessions;
  DELETE FROM context_entries;
  DELETE FROM invocation_logs;
  DELETE FROM agents;
  DELETE FROM providers;

  -- SQLite can't add NOT NULL FK columns to populated tables easily, but
  -- since we just emptied them, ALTER TABLE ADD COLUMN works.
  ALTER TABLE agents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE sessions ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE context_entries ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE invocation_logs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE providers ADD COLUMN workspace_id TEXT NOT NULL DEFAULT '';

  CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_context_entries_workspace ON context_entries(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_invocation_logs_workspace ON invocation_logs(workspace_id);

  UPDATE schema_version SET version = 3;
  `,
];

export interface SqliteStoreOptions {
  path: string;
  wal?: boolean;
  verbose?: boolean;
  workspaceId?: string;
}

export class SqliteStore implements UnifiedStore {
  private db: DatabaseType;
  private ownsDb: boolean;
  private lastTs = 0;
  readonly workspaceId: string | null;

  private nextTimestamp(): string {
    const now = Date.now();
    const next = now > this.lastTs ? now : this.lastTs + 1;
    this.lastTs = next;
    return new Date(next).toISOString();
  }

  constructor(options: SqliteStoreOptions | string, _internal?: { db: DatabaseType; workspaceId: string }) {
    if (_internal) {
      this.db = _internal.db;
      this.ownsDb = false;
      this.workspaceId = _internal.workspaceId;
      return;
    }

    const opts: SqliteStoreOptions =
      typeof options === "string" ? { path: options } : options;

    this.db = new Database(opts.path, {
      verbose: opts.verbose ? console.log : undefined,
    });
    this.ownsDb = true;
    this.workspaceId = opts.workspaceId ?? null;

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    if (opts.wal === false) {
      this.db.pragma("journal_mode = DELETE");
    }

    this.migrate();
  }

  forWorkspace(workspaceId: string): SqliteStore {
    return new SqliteStore({ path: ":memory:" }, { db: this.db, workspaceId });
  }

  private requireWorkspace(): string {
    if (!this.workspaceId) {
      throw new Error("SqliteStore: workspace not set. Call forWorkspace(id) first.");
    }
    return this.workspaceId;
  }

  private migrate(): void {
    const currentVersion = this.getSchemaVersion();
    for (let i = currentVersion; i < MIGRATIONS.length; i++) {
      this.db.exec(MIGRATIONS[i]);
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db
        .prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
        .get() as { version: number } | undefined;
      return row?.version ?? 0;
    } catch {
      return 0;
    }
  }

  // ═══ AgentStore ═══

  async getAgent(id: string): Promise<AgentDefinition | null> {
    const ws = this.requireWorkspace();
    const row = this.db
      .prepare(
        `SELECT definition FROM agents
         WHERE workspace_id = ? AND agent_id = ?
         ORDER BY activated_at DESC NULLS LAST
         LIMIT 1`
      )
      .get(ws, id) as { definition: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition) as AgentDefinition;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    const ws = this.requireWorkspace();
    const rows = this.db
      .prepare(
        `SELECT agent_id, name, description FROM agents
         WHERE workspace_id = ? AND (agent_id, activated_at) IN (
           SELECT agent_id, MAX(activated_at) FROM agents
           WHERE workspace_id = ? AND activated_at IS NOT NULL
           GROUP BY agent_id
         )
         ORDER BY name`
      )
      .all(ws, ws) as Array<{ agent_id: string; name: string; description: string | null }>;

    return rows.map((r) => ({
      id: r.agent_id,
      name: r.name,
      description: r.description ?? undefined,
    }));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    const ws = this.requireWorkspace();
    const now = this.nextTimestamp();
    const agentWithTimestamp = { ...agent, createdAt: now, updatedAt: now };
    this.db
      .prepare(
        `INSERT INTO agents (workspace_id, agent_id, name, description, definition, created_at, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(ws, agent.id, agent.name, agent.description ?? null, JSON.stringify(agentWithTimestamp), now, now);
  }

  async deleteAgent(id: string): Promise<void> {
    const ws = this.requireWorkspace();
    this.db.prepare("DELETE FROM agents WHERE workspace_id = ? AND agent_id = ?").run(ws, id);
  }

  async listAgentVersions(agentId: string): Promise<Array<{ createdAt: string; activatedAt: string | null }>> {
    const ws = this.requireWorkspace();
    const rows = this.db
      .prepare(
        `SELECT created_at, activated_at FROM agents
         WHERE workspace_id = ? AND agent_id = ?
         ORDER BY created_at DESC`
      )
      .all(ws, agentId) as Array<{ created_at: string; activated_at: string | null }>;
    return rows.map((r) => ({ createdAt: r.created_at, activatedAt: r.activated_at }));
  }

  async getAgentVersion(agentId: string, createdAt: string): Promise<AgentDefinition | null> {
    const ws = this.requireWorkspace();
    const row = this.db
      .prepare(
        `SELECT definition FROM agents
         WHERE workspace_id = ? AND agent_id = ? AND created_at = ?`
      )
      .get(ws, agentId, createdAt) as { definition: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition) as AgentDefinition;
  }

  async activateAgentVersion(agentId: string, createdAt: string): Promise<void> {
    const ws = this.requireWorkspace();
    const now = this.nextTimestamp();
    this.db
      .prepare(
        `UPDATE agents SET activated_at = ?
         WHERE workspace_id = ? AND agent_id = ? AND created_at = ?`
      )
      .run(now, ws, agentId, createdAt);
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    const ws = this.requireWorkspace();
    const rows = this.db
      .prepare(
        `SELECT m.role, m.content, m.tool_calls, m.tool_call_id, m.timestamp
         FROM messages m
         INNER JOIN sessions s ON s.id = m.session_id
         WHERE s.workspace_id = ? AND m.session_id = ?
         ORDER BY m.id`
      )
      .all(ws, sessionId) as Array<{
      role: string;
      content: string;
      tool_calls: string | null;
      tool_call_id: string | null;
      timestamp: string;
    }>;

    return rows.map((r) => {
      const msg: Message = {
        role: r.role as Message["role"],
        content: r.content,
        timestamp: r.timestamp,
      };
      if (r.tool_calls) msg.toolCalls = JSON.parse(r.tool_calls);
      if (r.tool_call_id) msg.toolCallId = r.tool_call_id;
      return msg;
    });
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    const ws = this.requireWorkspace();
    const now = new Date().toISOString();

    const checkOwnership = this.db.prepare(
      "SELECT workspace_id FROM sessions WHERE id = ?"
    );
    const upsertSession = this.db.prepare(
      `INSERT INTO sessions (workspace_id, id, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    );
    const insertMsg = this.db.prepare(
      `INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction(() => {
      const existing = checkOwnership.get(sessionId) as { workspace_id: string } | undefined;
      if (existing && existing.workspace_id !== ws) {
        throw new Error(`Session ${sessionId} belongs to a different workspace`);
      }
      upsertSession.run(ws, sessionId, now, now);
      for (const msg of messages) {
        insertMsg.run(
          sessionId,
          msg.role,
          msg.content,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.toolCallId ?? null,
          msg.timestamp
        );
      }
    });

    transaction();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const ws = this.requireWorkspace();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM messages WHERE session_id IN (
            SELECT id FROM sessions WHERE workspace_id = ? AND id = ?
          )`
        )
        .run(ws, sessionId);
      this.db.prepare("DELETE FROM sessions WHERE workspace_id = ? AND id = ?").run(ws, sessionId);
    });
    transaction();
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    const ws = this.requireWorkspace();
    let query = `
      SELECT s.id, s.agent_id, s.created_at, s.updated_at,
             COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.workspace_id = ?
    `;
    const params: string[] = [ws];

    if (agentId) {
      query += " AND s.agent_id = ?";
      params.push(agentId);
    }

    query += " GROUP BY s.id ORDER BY s.updated_at DESC";

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      agent_id: string | null;
      created_at: string;
      updated_at: string;
      message_count: number;
    }>;

    return rows.map((r) => ({
      sessionId: r.id,
      agentId: r.agent_id ?? undefined,
      messageCount: r.message_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // ═══ ContextStore ═══

  async getContext(contextId: string): Promise<ContextEntry[]> {
    const ws = this.requireWorkspace();
    const rows = this.db
      .prepare(
        `SELECT context_id, agent_id, invocation_id, content, created_at FROM context_entries
         WHERE workspace_id = ? AND context_id = ? ORDER BY id`
      )
      .all(ws, contextId) as Array<{
      context_id: string;
      agent_id: string;
      invocation_id: string;
      content: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      contextId: r.context_id,
      agentId: r.agent_id,
      invocationId: r.invocation_id,
      content: r.content,
      createdAt: r.created_at,
    }));
  }

  async addContext(contextId: string, entry: ContextEntry): Promise<void> {
    const ws = this.requireWorkspace();
    this.db
      .prepare(
        `INSERT INTO context_entries (workspace_id, context_id, agent_id, invocation_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(ws, contextId, entry.agentId, entry.invocationId, entry.content, entry.createdAt);
  }

  async clearContext(contextId: string): Promise<void> {
    const ws = this.requireWorkspace();
    this.db
      .prepare("DELETE FROM context_entries WHERE workspace_id = ? AND context_id = ?")
      .run(ws, contextId);
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    const ws = this.requireWorkspace();
    this.db
      .prepare(
        `INSERT INTO invocation_logs (workspace_id, id, agent_id, session_id, input, output, tool_calls,
          prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        ws,
        entry.id,
        entry.agentId,
        entry.sessionId ?? null,
        entry.input,
        entry.output,
        JSON.stringify(entry.toolCalls),
        entry.usage.promptTokens,
        entry.usage.completionTokens,
        entry.usage.totalTokens,
        entry.duration,
        entry.model,
        entry.error ?? null,
        entry.timestamp
      );
  }

  async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
    const ws = this.requireWorkspace();
    let query = "SELECT * FROM invocation_logs WHERE workspace_id = ?";
    const params: unknown[] = [ws];

    if (filter?.agentId) {
      query += " AND agent_id = ?";
      params.push(filter.agentId);
    }
    if (filter?.sessionId) {
      query += " AND session_id = ?";
      params.push(filter.sessionId);
    }
    if (filter?.since) {
      query += " AND timestamp >= ?";
      params.push(filter.since);
    }

    query += " ORDER BY timestamp DESC";

    if (filter?.limit) {
      query += " LIMIT ?";
      params.push(filter.limit);
    }
    if (filter?.offset) {
      query += " OFFSET ?";
      params.push(filter.offset);
    }

    const rows = this.db.prepare(query).all(...params) as Array<LogRow>;
    return rows.map(rowToLog);
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    const ws = this.requireWorkspace();
    const row = this.db
      .prepare("SELECT * FROM invocation_logs WHERE workspace_id = ? AND id = ?")
      .get(ws, id) as LogRow | undefined;
    if (!row) return null;
    return rowToLog(row);
  }

  // ═══ ProviderStore ═══

  async getProvider(id: string): Promise<ProviderConfig | null> {
    const ws = this.requireWorkspace();
    const row = this.db
      .prepare(
        "SELECT id, api_key, base_url, config, updated_at FROM providers WHERE workspace_id = ? AND id = ?"
      )
      .get(ws, id) as
      | { id: string; api_key: string; base_url: string | null; config: string | null; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      apiKey: row.api_key,
      baseUrl: row.base_url ?? undefined,
      config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : undefined,
      updatedAt: row.updated_at,
    };
  }

  async listProviders(): Promise<Array<{ id: string; configured: boolean }>> {
    const ws = this.requireWorkspace();
    const rows = this.db
      .prepare("SELECT id, api_key FROM providers WHERE workspace_id = ? ORDER BY id")
      .all(ws) as Array<{ id: string; api_key: string }>;
    return rows.map((r) => ({ id: r.id, configured: !!r.api_key }));
  }

  async putProvider(provider: ProviderConfig): Promise<void> {
    const ws = this.requireWorkspace();
    const now = new Date().toISOString();
    // Per-workspace upsert: SQLite single-PK on id wouldn't work cross-workspace,
    // so emulate workspace-scoped upsert manually.
    const existing = this.db
      .prepare("SELECT id FROM providers WHERE workspace_id = ? AND id = ?")
      .get(ws, provider.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE providers SET api_key = ?, base_url = ?, config = ?, updated_at = ?
           WHERE workspace_id = ? AND id = ?`
        )
        .run(
          provider.apiKey,
          provider.baseUrl ?? null,
          provider.config ? JSON.stringify(provider.config) : null,
          now,
          ws,
          provider.id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO providers (workspace_id, id, api_key, base_url, config, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          ws,
          provider.id,
          provider.apiKey,
          provider.baseUrl ?? null,
          provider.config ? JSON.stringify(provider.config) : null,
          now
        );
    }
  }

  async deleteProvider(id: string): Promise<void> {
    const ws = this.requireWorkspace();
    this.db.prepare("DELETE FROM providers WHERE workspace_id = ? AND id = ?").run(ws, id);
  }

  // ═══ WorkspaceStore (unscoped) ═══

  async getWorkspaceByClerkOrgId(clerkOrgId: string): Promise<Workspace | null> {
    const row = this.db
      .prepare("SELECT id, clerk_org_id, name, created_at FROM workspaces WHERE clerk_org_id = ?")
      .get(clerkOrgId) as { id: string; clerk_org_id: string; name: string; created_at: string } | undefined;
    if (!row) return null;
    return rowToWorkspace(row);
  }

  async getWorkspaceById(id: string): Promise<Workspace | null> {
    const row = this.db
      .prepare("SELECT id, clerk_org_id, name, created_at FROM workspaces WHERE id = ?")
      .get(id) as { id: string; clerk_org_id: string; name: string; created_at: string } | undefined;
    if (!row) return null;
    return rowToWorkspace(row);
  }

  async createWorkspace(params: { clerkOrgId: string; name: string }): Promise<Workspace> {
    const existing = await this.getWorkspaceByClerkOrgId(params.clerkOrgId);
    if (existing) return existing;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO workspaces (id, clerk_org_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, params.clerkOrgId, params.name, now);
    return { id, clerkOrgId: params.clerkOrgId, name: params.name, createdAt: now };
  }

  // ═══ ApiKeyStore (unscoped) ═══

  async createApiKey(params: { workspaceId: string; name: string }): Promise<{ record: ApiKeyRecord; rawKey: string }> {
    const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
    const keyPrefix = rawKey.slice(0, 14);
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO api_keys (id, workspace_id, name, key_prefix, key_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, params.workspaceId, params.name, keyPrefix, keyHash, now);
    return {
      record: {
        id,
        workspaceId: params.workspaceId,
        name: params.name,
        keyPrefix,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      },
      rawKey,
    };
  }

  async listApiKeys(workspaceId: string): Promise<ApiKeyRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, name, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys WHERE workspace_id = ? ORDER BY created_at DESC`
      )
      .all(workspaceId) as Array<ApiKeyRow>;
    return rows.map(rowToApiKey);
  }

  async revokeApiKey(params: { workspaceId: string; keyId: string }): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE api_keys SET revoked_at = ?
         WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL`
      )
      .run(now, params.keyId, params.workspaceId);
  }

  async resolveApiKey(rawKey: string): Promise<{ workspaceId: string; keyId: string } | null> {
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const row = this.db
      .prepare(
        `SELECT id, workspace_id FROM api_keys
         WHERE key_hash = ? AND revoked_at IS NULL`
      )
      .get(keyHash) as { id: string; workspace_id: string } | undefined;
    if (!row) return null;
    this.db
      .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    return { workspaceId: row.workspace_id, keyId: row.id };
  }

  // ═══ Lifecycle ═══

  close(): void {
    if (this.ownsDb) {
      this.db.close();
    }
  }

  get database(): DatabaseType {
    return this.db;
  }
}

interface LogRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  input: string;
  output: string;
  tool_calls: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration: number;
  model: string;
  error: string | null;
  timestamp: string;
}

interface ApiKeyRow {
  id: string;
  workspace_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function rowToLog(r: LogRow): InvocationLog {
  return {
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id ?? undefined,
    input: r.input,
    output: r.output,
    toolCalls: JSON.parse(r.tool_calls),
    usage: {
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
    },
    duration: r.duration,
    model: r.model,
    error: r.error ?? undefined,
    timestamp: r.timestamp,
  };
}

function rowToWorkspace(r: { id: string; clerk_org_id: string; name: string; created_at: string }): Workspace {
  return {
    id: r.id,
    clerkOrgId: r.clerk_org_id,
    name: r.name,
    createdAt: r.created_at,
  };
}

function rowToApiKey(r: ApiKeyRow): ApiKeyRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    name: r.name,
    keyPrefix: r.key_prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}
