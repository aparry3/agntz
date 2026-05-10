import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
  AgentDefinition,
  ProviderConfig,
  UnifiedStore,
  ApiKeyRecord,
  Connection,
  ConnectionKind,
  ConnectionConfig,
  Message,
  SessionSummary,
  ContextEntry,
  InvocationLog,
  InvokeResult,
  LogFilter,
  Run,
  RunStatus,
} from "@agntz/core";

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
  // v3: Per-user scoping + API keys. Dev data is wiped (can't backfill).
  `
  DROP TABLE IF EXISTS workspaces;

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash_active
    ON api_keys(key_hash) WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

  DELETE FROM messages;
  DELETE FROM sessions;
  DELETE FROM context_entries;
  DELETE FROM invocation_logs;
  DELETE FROM agents;
  DELETE FROM providers;

  ALTER TABLE agents ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE context_entries ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE invocation_logs ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE providers ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

  CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_context_entries_user ON context_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_invocation_logs_user ON invocation_logs(user_id);

  UPDATE schema_version SET version = 3;
  `,
  // v4: User-scoped connections (MCP servers today; more kinds later).
  `
  CREATE TABLE IF NOT EXISTS connections (
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description  TEXT,
    config       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, kind, id)
  );
  CREATE INDEX IF NOT EXISTS idx_connections_user_kind ON connections(user_id, kind);

  UPDATE schema_version SET version = 4;
  `,
  // v5: Runs — first-class agent invocations tracked by RunRegistry.
  // Composite PK on (user_id, id) so Run ids are unique per user, mirroring
  // the per-user scoping used by providers/connections.
  `
  CREATE TABLE IF NOT EXISTS runs (
    user_id           TEXT NOT NULL,
    id                TEXT NOT NULL,
    root_id           TEXT NOT NULL,
    parent_id         TEXT,
    agent_id          TEXT NOT NULL,
    session_id        TEXT,
    spawn_tool_use_id TEXT,
    status            TEXT NOT NULL,
    input             TEXT NOT NULL,
    output            TEXT,
    result_json       TEXT,
    error             TEXT,
    started_at        INTEGER NOT NULL,
    ended_at          INTEGER,
    depth             INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(user_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_runs_root ON runs(user_id, root_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(user_id, status);

  UPDATE schema_version SET version = 5;
  `,
];

export interface SqliteStoreOptions {
  path: string;
  wal?: boolean;
  verbose?: boolean;
  userId?: string;
}

export class SqliteStore implements UnifiedStore {
  private db: DatabaseType;
  private ownsDb: boolean;
  private lastTs = 0;
  readonly userId: string | null;

  private nextTimestamp(): string {
    const now = Date.now();
    const next = now > this.lastTs ? now : this.lastTs + 1;
    this.lastTs = next;
    return new Date(next).toISOString();
  }

  constructor(options: SqliteStoreOptions | string, _internal?: { db: DatabaseType; userId: string }) {
    if (_internal) {
      this.db = _internal.db;
      this.ownsDb = false;
      this.userId = _internal.userId;
      return;
    }

    const opts: SqliteStoreOptions =
      typeof options === "string" ? { path: options } : options;

    this.db = new Database(opts.path, {
      verbose: opts.verbose ? console.log : undefined,
    });
    this.ownsDb = true;
    this.userId = opts.userId ?? null;

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    if (opts.wal === false) {
      this.db.pragma("journal_mode = DELETE");
    }

    this.migrate();
  }

  forUser(userId: string): SqliteStore {
    return new SqliteStore({ path: ":memory:" }, { db: this.db, userId });
  }

  private requireUser(): string {
    if (!this.userId) {
      throw new Error("SqliteStore: user not set. Call forUser(id) first.");
    }
    return this.userId;
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
    const u = this.requireUser();
    const row = this.db
      .prepare(
        `SELECT definition FROM agents
         WHERE user_id = ? AND agent_id = ?
         ORDER BY activated_at DESC NULLS LAST
         LIMIT 1`
      )
      .get(u, id) as { definition: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition) as AgentDefinition;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    const u = this.requireUser();
    const rows = this.db
      .prepare(
        `SELECT agent_id, name, description FROM agents
         WHERE user_id = ? AND (agent_id, activated_at) IN (
           SELECT agent_id, MAX(activated_at) FROM agents
           WHERE user_id = ? AND activated_at IS NOT NULL
           GROUP BY agent_id
         )
         ORDER BY name`
      )
      .all(u, u) as Array<{ agent_id: string; name: string; description: string | null }>;

    return rows.map((r) => ({
      id: r.agent_id,
      name: r.name,
      description: r.description ?? undefined,
    }));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    const u = this.requireUser();
    const now = this.nextTimestamp();
    const agentWithTimestamp = { ...agent, createdAt: now, updatedAt: now };
    this.db
      .prepare(
        `INSERT INTO agents (user_id, agent_id, name, description, definition, created_at, activated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(u, agent.id, agent.name, agent.description ?? null, JSON.stringify(agentWithTimestamp), now, now);
  }

  async deleteAgent(id: string): Promise<void> {
    const u = this.requireUser();
    this.db.prepare("DELETE FROM agents WHERE user_id = ? AND agent_id = ?").run(u, id);
  }

  async listAgentVersions(agentId: string): Promise<Array<{ createdAt: string; activatedAt: string | null }>> {
    const u = this.requireUser();
    const rows = this.db
      .prepare(
        `SELECT created_at, activated_at FROM agents
         WHERE user_id = ? AND agent_id = ?
         ORDER BY created_at DESC`
      )
      .all(u, agentId) as Array<{ created_at: string; activated_at: string | null }>;
    return rows.map((r) => ({ createdAt: r.created_at, activatedAt: r.activated_at }));
  }

  async getAgentVersion(agentId: string, createdAt: string): Promise<AgentDefinition | null> {
    const u = this.requireUser();
    const row = this.db
      .prepare(
        `SELECT definition FROM agents
         WHERE user_id = ? AND agent_id = ? AND created_at = ?`
      )
      .get(u, agentId, createdAt) as { definition: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition) as AgentDefinition;
  }

  async activateAgentVersion(agentId: string, createdAt: string): Promise<void> {
    const u = this.requireUser();
    const now = this.nextTimestamp();
    this.db
      .prepare(
        `UPDATE agents SET activated_at = ?
         WHERE user_id = ? AND agent_id = ? AND created_at = ?`
      )
      .run(now, u, agentId, createdAt);
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    const u = this.requireUser();
    const rows = this.db
      .prepare(
        `SELECT m.role, m.content, m.tool_calls, m.tool_call_id, m.timestamp
         FROM messages m
         INNER JOIN sessions s ON s.id = m.session_id
         WHERE s.user_id = ? AND m.session_id = ?
         ORDER BY m.id`
      )
      .all(u, sessionId) as Array<{
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
    const u = this.requireUser();
    const now = new Date().toISOString();

    const checkOwnership = this.db.prepare("SELECT user_id FROM sessions WHERE id = ?");
    const upsertSession = this.db.prepare(
      `INSERT INTO sessions (user_id, id, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    );
    const insertMsg = this.db.prepare(
      `INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction(() => {
      const existing = checkOwnership.get(sessionId) as { user_id: string } | undefined;
      if (existing && existing.user_id !== u) {
        throw new Error(`Session ${sessionId} belongs to a different user`);
      }
      upsertSession.run(u, sessionId, now, now);
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
    const u = this.requireUser();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM messages WHERE session_id IN (
            SELECT id FROM sessions WHERE user_id = ? AND id = ?
          )`
        )
        .run(u, sessionId);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND id = ?").run(u, sessionId);
    });
    transaction();
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    const u = this.requireUser();
    let query = `
      SELECT s.id, s.agent_id, s.created_at, s.updated_at,
             COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.user_id = ?
    `;
    const params: string[] = [u];

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
    const u = this.requireUser();
    const rows = this.db
      .prepare(
        `SELECT context_id, agent_id, invocation_id, content, created_at FROM context_entries
         WHERE user_id = ? AND context_id = ? ORDER BY id`
      )
      .all(u, contextId) as Array<{
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
    const u = this.requireUser();
    this.db
      .prepare(
        `INSERT INTO context_entries (user_id, context_id, agent_id, invocation_id, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(u, contextId, entry.agentId, entry.invocationId, entry.content, entry.createdAt);
  }

  async clearContext(contextId: string): Promise<void> {
    const u = this.requireUser();
    this.db
      .prepare("DELETE FROM context_entries WHERE user_id = ? AND context_id = ?")
      .run(u, contextId);
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    const u = this.requireUser();
    this.db
      .prepare(
        `INSERT INTO invocation_logs (user_id, id, agent_id, session_id, input, output, tool_calls,
          prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        u,
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
    const u = this.requireUser();
    let query = "SELECT * FROM invocation_logs WHERE user_id = ?";
    const params: unknown[] = [u];

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
    const u = this.requireUser();
    const row = this.db
      .prepare("SELECT * FROM invocation_logs WHERE user_id = ? AND id = ?")
      .get(u, id) as LogRow | undefined;
    if (!row) return null;
    return rowToLog(row);
  }

  // ═══ ProviderStore ═══

  async getProvider(id: string): Promise<ProviderConfig | null> {
    const u = this.requireUser();
    const row = this.db
      .prepare(
        "SELECT id, api_key, base_url, config, updated_at FROM providers WHERE user_id = ? AND id = ?"
      )
      .get(u, id) as
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
    const u = this.requireUser();
    const rows = this.db
      .prepare("SELECT id, api_key FROM providers WHERE user_id = ? ORDER BY id")
      .all(u) as Array<{ id: string; api_key: string }>;
    return rows.map((r) => ({ id: r.id, configured: !!r.api_key }));
  }

  async putProvider(provider: ProviderConfig): Promise<void> {
    const u = this.requireUser();
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT id FROM providers WHERE user_id = ? AND id = ?")
      .get(u, provider.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE providers SET api_key = ?, base_url = ?, config = ?, updated_at = ?
           WHERE user_id = ? AND id = ?`
        )
        .run(
          provider.apiKey,
          provider.baseUrl ?? null,
          provider.config ? JSON.stringify(provider.config) : null,
          now,
          u,
          provider.id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO providers (user_id, id, api_key, base_url, config, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          u,
          provider.id,
          provider.apiKey,
          provider.baseUrl ?? null,
          provider.config ? JSON.stringify(provider.config) : null,
          now
        );
    }
  }

  async deleteProvider(id: string): Promise<void> {
    const u = this.requireUser();
    this.db.prepare("DELETE FROM providers WHERE user_id = ? AND id = ?").run(u, id);
  }

  // ═══ ConnectionStore ═══

  async getConnection(kind: ConnectionKind, id: string): Promise<Connection | null> {
    const u = this.requireUser();
    const row = this.db
      .prepare(
        `SELECT id, kind, display_name, description, config, created_at, updated_at
         FROM connections
         WHERE user_id = ? AND kind = ? AND id = ?`
      )
      .get(u, kind, id) as
      | {
          id: string;
          kind: string;
          display_name: string;
          description: string | null;
          config: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return sqliteRowToConnection(row);
  }

  async listConnections(kind?: ConnectionKind): Promise<Connection[]> {
    const u = this.requireUser();
    const rows = kind
      ? (this.db
          .prepare(
            `SELECT id, kind, display_name, description, config, created_at, updated_at
             FROM connections WHERE user_id = ? AND kind = ? ORDER BY kind, id`
          )
          .all(u, kind) as Array<{
          id: string;
          kind: string;
          display_name: string;
          description: string | null;
          config: string;
          created_at: string;
          updated_at: string;
        }>)
      : (this.db
          .prepare(
            `SELECT id, kind, display_name, description, config, created_at, updated_at
             FROM connections WHERE user_id = ? ORDER BY kind, id`
          )
          .all(u) as Array<{
          id: string;
          kind: string;
          display_name: string;
          description: string | null;
          config: string;
          created_at: string;
          updated_at: string;
        }>);
    return rows.map(sqliteRowToConnection);
  }

  async putConnection(connection: Connection): Promise<void> {
    const u = this.requireUser();
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        `SELECT 1 FROM connections WHERE user_id = ? AND kind = ? AND id = ?`
      )
      .get(u, connection.kind, connection.id);
    if (existing) {
      this.db
        .prepare(
          `UPDATE connections
           SET display_name = ?, description = ?, config = ?, updated_at = ?
           WHERE user_id = ? AND kind = ? AND id = ?`
        )
        .run(
          connection.displayName,
          connection.description ?? null,
          JSON.stringify(connection.config),
          now,
          u,
          connection.kind,
          connection.id
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO connections
             (user_id, kind, id, display_name, description, config, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          u,
          connection.kind,
          connection.id,
          connection.displayName,
          connection.description ?? null,
          JSON.stringify(connection.config),
          now,
          now
        );
    }
  }

  async deleteConnection(kind: ConnectionKind, id: string): Promise<void> {
    const u = this.requireUser();
    this.db
      .prepare("DELETE FROM connections WHERE user_id = ? AND kind = ? AND id = ?")
      .run(u, kind, id);
  }

  // ═══ RunStore ═══

  async putRun(run: Run): Promise<void> {
    const u = this.requireUser();
    this.db
      .prepare(
        `INSERT INTO runs (
            user_id, id, root_id, parent_id, agent_id, session_id,
            spawn_tool_use_id, status, input, output, result_json, error,
            started_at, ended_at, depth
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, id) DO UPDATE SET
           root_id = excluded.root_id,
           parent_id = excluded.parent_id,
           agent_id = excluded.agent_id,
           session_id = excluded.session_id,
           spawn_tool_use_id = excluded.spawn_tool_use_id,
           status = excluded.status,
           input = excluded.input,
           output = excluded.output,
           result_json = excluded.result_json,
           error = excluded.error,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           depth = excluded.depth`
      )
      .run(
        u,
        run.id,
        run.rootId,
        run.parentId ?? null,
        run.agentId,
        run.sessionId ?? null,
        run.spawnToolUseId ?? null,
        run.status,
        run.input,
        run.result?.output ?? null,
        run.result ? JSON.stringify(run.result) : null,
        run.error ?? null,
        run.startedAt,
        run.endedAt ?? null,
        run.depth
      );
  }

  async getRun(runId: string): Promise<Run | null> {
    const u = this.requireUser();
    const row = this.db
      .prepare(
        `SELECT id, user_id, root_id, parent_id, agent_id, session_id,
                spawn_tool_use_id, status, input, output, result_json, error,
                started_at, ended_at, depth
         FROM runs
         WHERE user_id = ? AND id = ?`
      )
      .get(u, runId) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  async listChildren(parentRunId: string): Promise<Run[]> {
    const u = this.requireUser();
    const rows = this.db
      .prepare(
        `SELECT id, user_id, root_id, parent_id, agent_id, session_id,
                spawn_tool_use_id, status, input, output, result_json, error,
                started_at, ended_at, depth
         FROM runs
         WHERE user_id = ? AND parent_id = ?
         ORDER BY started_at, id`
      )
      .all(u, parentRunId) as RunRow[];
    return rows.map(rowToRun);
  }

  async listSubtree(rootId: string): Promise<Run[]> {
    const u = this.requireUser();
    // Recursive CTE walks the parent_id graph starting at rootId.
    // Includes the root itself when present.
    const rows = this.db
      .prepare(
        `WITH RECURSIVE subtree(id) AS (
            SELECT id FROM runs WHERE user_id = ? AND id = ?
            UNION ALL
            SELECT r.id FROM runs r
            INNER JOIN subtree s ON r.parent_id = s.id
            WHERE r.user_id = ?
         )
         SELECT r.id, r.user_id, r.root_id, r.parent_id, r.agent_id, r.session_id,
                r.spawn_tool_use_id, r.status, r.input, r.output, r.result_json, r.error,
                r.started_at, r.ended_at, r.depth
         FROM runs r
         INNER JOIN subtree s ON s.id = r.id
         WHERE r.user_id = ?
         ORDER BY r.depth, r.started_at, r.id`
      )
      .all(u, rootId, u, u) as RunRow[];
    return rows.map(rowToRun);
  }

  // ═══ ApiKeyStore (unscoped) ═══

  async createApiKey(params: { userId: string; name: string }): Promise<{ record: ApiKeyRecord; rawKey: string }> {
    const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
    const keyPrefix = rawKey.slice(0, 14);
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, params.userId, params.name, keyPrefix, keyHash, now);
    return {
      record: {
        id,
        userId: params.userId,
        name: params.name,
        keyPrefix,
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      },
      rawKey,
    };
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT id, user_id, name, key_prefix, created_at, last_used_at, revoked_at
         FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`
      )
      .all(userId) as Array<ApiKeyRow>;
    return rows.map(rowToApiKey);
  }

  async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE api_keys SET revoked_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
      )
      .run(now, params.keyId, params.userId);
  }

  async resolveApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const row = this.db
      .prepare(
        `SELECT id, user_id FROM api_keys
         WHERE key_hash = ? AND revoked_at IS NULL`
      )
      .get(keyHash) as { id: string; user_id: string } | undefined;
    if (!row) return null;
    this.db
      .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
      .run(new Date().toISOString(), row.id);
    return { userId: row.user_id, keyId: row.id };
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
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface RunRow {
  id: string;
  user_id: string;
  root_id: string;
  parent_id: string | null;
  agent_id: string;
  session_id: string | null;
  spawn_tool_use_id: string | null;
  status: string;
  input: string;
  output: string | null;
  result_json: string | null;
  error: string | null;
  started_at: number;
  ended_at: number | null;
  depth: number;
}

function rowToRun(r: RunRow): Run {
  const run: Run = {
    id: r.id,
    rootId: r.root_id,
    agentId: r.agent_id,
    status: r.status as RunStatus,
    input: r.input,
    startedAt: r.started_at,
    depth: r.depth,
  };
  if (r.user_id) run.userId = r.user_id;
  if (r.parent_id !== null) run.parentId = r.parent_id;
  if (r.session_id !== null) run.sessionId = r.session_id;
  if (r.spawn_tool_use_id !== null) run.spawnToolUseId = r.spawn_tool_use_id;
  if (r.error !== null) run.error = r.error;
  if (r.ended_at !== null) run.endedAt = r.ended_at;
  if (r.result_json !== null) run.result = JSON.parse(r.result_json) as InvokeResult;
  return run;
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

function sqliteRowToConnection(r: {
  id: string;
  kind: string;
  display_name: string;
  description: string | null;
  config: string;
  created_at: string;
  updated_at: string;
}): Connection {
  return {
    id: r.id,
    kind: r.kind as ConnectionKind,
    displayName: r.display_name,
    description: r.description ?? undefined,
    config: JSON.parse(r.config) as ConnectionConfig,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToApiKey(r: ApiKeyRow): ApiKeyRecord {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    keyPrefix: r.key_prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}
