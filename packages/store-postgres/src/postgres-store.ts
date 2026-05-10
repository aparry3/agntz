import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
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

const { Pool } = pg;
type PoolType = InstanceType<typeof pg.Pool>;
type PoolConfig = pg.PoolConfig;

// ═══════════════════════════════════════════════════════════════════════
// Schema Migrations
// ═══════════════════════════════════════════════════════════════════════

const MIGRATIONS: string[] = [
  // v1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS ar_agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ar_sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS ar_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES ar_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id TEXT,
    timestamp TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ar_messages_session ON ar_messages(session_id);

  CREATE TABLE IF NOT EXISTS ar_context_entries (
    id SERIAL PRIMARY KEY,
    context_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    invocation_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_ar_context_entries_context ON ar_context_entries(context_id);

  CREATE TABLE IF NOT EXISTS ar_invocation_logs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    input TEXT NOT NULL,
    output TEXT NOT NULL,
    tool_calls JSONB NOT NULL DEFAULT '[]',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    duration INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    error TEXT,
    timestamp TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ar_logs_agent ON ar_invocation_logs(agent_id);
  CREATE INDEX IF NOT EXISTS idx_ar_logs_session ON ar_invocation_logs(session_id);
  CREATE INDEX IF NOT EXISTS idx_ar_logs_timestamp ON ar_invocation_logs(timestamp);

  CREATE TABLE IF NOT EXISTS ar_schema_version (
    version INTEGER PRIMARY KEY
  );
  INSERT INTO ar_schema_version (version) VALUES (1);
  `,
  // v2: Provider configuration
  `
  CREATE TABLE IF NOT EXISTS ar_providers (
    id TEXT PRIMARY KEY,
    api_key TEXT NOT NULL,
    base_url TEXT,
    config JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  UPDATE ar_schema_version SET version = 2;
  `,
  // v3: Agent versioning — composite PK (agent_id, created_at)
  `
  CREATE TABLE IF NOT EXISTS ar_agents_new (
    agent_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    PRIMARY KEY (agent_id, created_at)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_agents_new_active ON ar_agents_new(agent_id, activated_at);

  INSERT INTO ar_agents_new (agent_id, name, description, definition, created_at, activated_at)
  SELECT id, name, description, definition, created_at, COALESCE(updated_at, created_at)
  FROM ar_agents
  ON CONFLICT DO NOTHING;

  DROP TABLE ar_agents;
  ALTER TABLE ar_agents_new RENAME TO ar_agents;
  ALTER INDEX idx_ar_agents_new_active RENAME TO idx_ar_agents_active;

  UPDATE ar_schema_version SET version = 3;
  `,
  // v4: Per-user scoping + API keys. Workspaces are not a first-class concept;
  // every scoped row carries a user_id (Clerk user id as TEXT). Dev data is
  // wiped — we can't guess ownership.
  `
  -- Previous in-dev attempts may have left ar_workspaces behind. Drop with
  -- CASCADE to clear any lingering FKs.
  DROP TABLE IF EXISTS ar_workspaces CASCADE;

  CREATE TABLE IF NOT EXISTS ar_api_keys (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_api_keys_hash_active
    ON ar_api_keys(key_hash) WHERE revoked_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ar_api_keys_user ON ar_api_keys(user_id);

  -- Wipe pre-scoping rows so we can add NOT NULL user_id without backfill.
  TRUNCATE ar_messages, ar_sessions, ar_context_entries, ar_invocation_logs,
           ar_agents, ar_providers RESTART IDENTITY CASCADE;

  ALTER TABLE ar_agents ADD COLUMN user_id TEXT NOT NULL;
  ALTER TABLE ar_sessions ADD COLUMN user_id TEXT NOT NULL;
  ALTER TABLE ar_context_entries ADD COLUMN user_id TEXT NOT NULL;
  ALTER TABLE ar_invocation_logs ADD COLUMN user_id TEXT NOT NULL;
  ALTER TABLE ar_providers ADD COLUMN user_id TEXT NOT NULL;

  -- Providers: swap single-column PK for composite on (user_id, id).
  ALTER TABLE ar_providers DROP CONSTRAINT IF EXISTS ar_providers_pkey;
  ALTER TABLE ar_providers ADD PRIMARY KEY (user_id, id);

  CREATE INDEX IF NOT EXISTS idx_ar_agents_user ON ar_agents(user_id);
  CREATE INDEX IF NOT EXISTS idx_ar_sessions_user ON ar_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_ar_context_entries_user ON ar_context_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_ar_invocation_logs_user ON ar_invocation_logs(user_id);

  UPDATE ar_schema_version SET version = 4;
  `,
  // v5: User-scoped connections (MCP servers today; more kinds later).
  `
  CREATE TABLE IF NOT EXISTS ar_connections (
    user_id      TEXT NOT NULL,
    kind         TEXT NOT NULL,
    id           TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description  TEXT,
    config       JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, kind, id)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_connections_user_kind ON ar_connections(user_id, kind);

  UPDATE ar_schema_version SET version = 5;
  `,
  // v6: Runs — first-class agent invocations tracked by RunRegistry.
  // Composite PK on (user_id, id) so Run ids are unique per user, mirroring
  // the per-user scoping used by providers/connections.
  `
  CREATE TABLE IF NOT EXISTS ar_runs (
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
    result_json       JSONB,
    error             TEXT,
    started_at        BIGINT NOT NULL,
    ended_at          BIGINT,
    depth             INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_runs_parent ON ar_runs(user_id, parent_id);
  CREATE INDEX IF NOT EXISTS idx_ar_runs_root ON ar_runs(user_id, root_id);
  CREATE INDEX IF NOT EXISTS idx_ar_runs_status ON ar_runs(user_id, status);

  UPDATE ar_schema_version SET version = 6;
  `,
];

export interface PostgresStoreOptions {
  connection: string | PoolType | PoolConfig;
  tablePrefix?: string;
  skipMigration?: boolean;
  userId?: string;
}

export class PostgresStore implements UnifiedStore {
  private pool: PoolType;
  private ownsPool: boolean;
  private prefix: string;
  private migrated: boolean = false;
  private migratePromise: Promise<void> | null = null;
  private lastTs = 0;
  readonly userId: string | null;

  private nextTimestamp(): string {
    const now = Date.now();
    const next = now > this.lastTs ? now : this.lastTs + 1;
    this.lastTs = next;
    return new Date(next).toISOString();
  }

  constructor(options: PostgresStoreOptions | string) {
    const opts: PostgresStoreOptions =
      typeof options === "string" ? { connection: options } : options;

    this.prefix = opts.tablePrefix ?? "ar_";
    this.userId = opts.userId ?? null;

    if (typeof opts.connection === "string") {
      this.pool = new Pool({ connectionString: opts.connection });
      this.ownsPool = true;
    } else if (opts.connection instanceof Pool) {
      this.pool = opts.connection;
      this.ownsPool = false;
    } else {
      this.pool = new Pool(opts.connection);
      this.ownsPool = true;
    }

    if (!opts.skipMigration) {
      this.migratePromise = this.migrate();
    }
  }

  forUser(userId: string): PostgresStore {
    const scoped = new PostgresStore({
      connection: this.pool,
      tablePrefix: this.prefix,
      skipMigration: true,
      userId,
    });
    // Share the parent's migration state so scoped calls await any in-flight
    // migration kicked off by the admin's constructor rather than racing it.
    scoped.migrated = this.migrated;
    scoped.migratePromise = this.migratePromise;
    return scoped;
  }

  private requireUser(): string {
    if (!this.userId) {
      throw new Error("PostgresStore: user not set. Call forUser(id) first.");
    }
    return this.userId;
  }

  private t(name: string): string {
    return `${this.prefix}${name}`;
  }

  private async ensureMigrated(): Promise<void> {
    if (this.migrated) return;
    if (this.migratePromise) {
      await this.migratePromise;
      return;
    }
    this.migratePromise = this.migrate();
    await this.migratePromise;
  }

  private async migrate(): Promise<void> {
    const currentVersion = await this.getSchemaVersion();
    for (let i = currentVersion; i < MIGRATIONS.length; i++) {
      const sql = MIGRATIONS[i].replace(/ar_/g, this.prefix);
      await this.pool.query(sql);
    }
    this.migrated = true;
  }

  private async getSchemaVersion(): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT version FROM ${this.t("schema_version")} ORDER BY version DESC LIMIT 1`
      );
      return result.rows[0]?.version ?? 0;
    } catch {
      return 0;
    }
  }

  // ═══ AgentStore ═══

  async getAgent(id: string): Promise<AgentDefinition | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT definition FROM ${this.t("agents")}
       WHERE user_id = $1 AND agent_id = $2
       ORDER BY activated_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [u, id]
    );
    if (result.rows.length === 0) return null;
    const def = result.rows[0].definition;
    return (typeof def === "string" ? JSON.parse(def) : def) as AgentDefinition;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT DISTINCT ON (agent_id) agent_id, name, description
       FROM ${this.t("agents")}
       WHERE user_id = $1
       ORDER BY agent_id, activated_at DESC NULLS LAST, created_at DESC`,
      [u]
    );
    return result.rows
      .map((r: { agent_id: string; name: string; description: string | null }) => ({
        id: r.agent_id,
        name: r.name,
        description: r.description ?? undefined,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const now = this.nextTimestamp();
    const agentWithTimestamp = { ...agent, createdAt: now, updatedAt: now };

    await this.pool.query(
      `INSERT INTO ${this.t("agents")} (user_id, agent_id, name, description, definition, created_at, activated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [u, agent.id, agent.name, agent.description ?? null, JSON.stringify(agentWithTimestamp), now, now]
    );
  }

  async deleteAgent(id: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `DELETE FROM ${this.t("agents")} WHERE user_id = $1 AND agent_id = $2`,
      [u, id]
    );
  }

  async listAgentVersions(agentId: string): Promise<Array<{ createdAt: string; activatedAt: string | null }>> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT created_at, activated_at FROM ${this.t("agents")}
       WHERE user_id = $1 AND agent_id = $2
       ORDER BY created_at DESC`,
      [u, agentId]
    );
    return result.rows.map((r: { created_at: Date | string; activated_at: Date | string | null }) => ({
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      activatedAt: r.activated_at == null
        ? null
        : (r.activated_at instanceof Date ? r.activated_at.toISOString() : String(r.activated_at)),
    }));
  }

  async getAgentVersion(agentId: string, createdAt: string): Promise<AgentDefinition | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT definition FROM ${this.t("agents")}
       WHERE user_id = $1 AND agent_id = $2 AND created_at = $3`,
      [u, agentId, createdAt]
    );
    if (result.rows.length === 0) return null;
    const def = result.rows[0].definition;
    return (typeof def === "string" ? JSON.parse(def) : def) as AgentDefinition;
  }

  async activateAgentVersion(agentId: string, createdAt: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const now = this.nextTimestamp();
    await this.pool.query(
      `UPDATE ${this.t("agents")} SET activated_at = $1
       WHERE user_id = $2 AND agent_id = $3 AND created_at = $4`,
      [now, u, agentId, createdAt]
    );
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT m.role, m.content, m.tool_calls, m.tool_call_id, m.timestamp
       FROM ${this.t("messages")} m
       INNER JOIN ${this.t("sessions")} s ON s.id = m.session_id
       WHERE s.user_id = $1 AND m.session_id = $2
       ORDER BY m.id`,
      [u, sessionId]
    );

    return result.rows.map((r: {
      role: string;
      content: string;
      tool_calls: unknown;
      tool_call_id: string | null;
      timestamp: Date;
    }) => {
      const msg: Message = {
        role: r.role as Message["role"],
        content: r.content,
        timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
      };
      if (r.tool_calls) msg.toolCalls = r.tool_calls as Message["toolCalls"];
      if (r.tool_call_id) msg.toolCallId = r.tool_call_id;
      return msg;
    });
  }

  async append(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT user_id FROM ${this.t("sessions")} WHERE id = $1`,
        [sessionId]
      );
      if (existing.rows.length > 0 && existing.rows[0].user_id !== u) {
        throw new Error(`Session ${sessionId} belongs to a different user`);
      }

      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO ${this.t("sessions")} (user_id, id, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
        [u, sessionId, now]
      );

      for (const msg of messages) {
        await client.query(
          `INSERT INTO ${this.t("messages")} (session_id, role, content, tool_calls, tool_call_id, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            sessionId,
            msg.role,
            msg.content,
            msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            msg.toolCallId ?? null,
            msg.timestamp,
          ]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `DELETE FROM ${this.t("sessions")} WHERE user_id = $1 AND id = $2`,
      [u, sessionId]
    );
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    let query = `
      SELECT s.id, s.agent_id, s.created_at, s.updated_at,
             COUNT(m.id) as message_count
      FROM ${this.t("sessions")} s
      LEFT JOIN ${this.t("messages")} m ON m.session_id = s.id
      WHERE s.user_id = $1
    `;
    const params: string[] = [u];

    if (agentId) {
      query += ` AND s.agent_id = $${params.length + 1}`;
      params.push(agentId);
    }

    query += " GROUP BY s.id ORDER BY s.updated_at DESC";

    const result = await this.pool.query(query, params);

    return result.rows.map((r: {
      id: string;
      agent_id: string | null;
      created_at: Date;
      updated_at: Date;
      message_count: string;
    }) => ({
      sessionId: r.id,
      agentId: r.agent_id ?? undefined,
      messageCount: parseInt(r.message_count, 10),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    }));
  }

  // ═══ ContextStore ═══

  async getContext(contextId: string): Promise<ContextEntry[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT context_id, agent_id, invocation_id, content, created_at
       FROM ${this.t("context_entries")}
       WHERE user_id = $1 AND context_id = $2
       ORDER BY id`,
      [u, contextId]
    );

    return result.rows.map((r: {
      context_id: string;
      agent_id: string;
      invocation_id: string;
      content: string;
      created_at: Date;
    }) => ({
      contextId: r.context_id,
      agentId: r.agent_id,
      invocationId: r.invocation_id,
      content: r.content,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async addContext(contextId: string, entry: ContextEntry): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `INSERT INTO ${this.t("context_entries")} (user_id, context_id, agent_id, invocation_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [u, contextId, entry.agentId, entry.invocationId, entry.content, entry.createdAt]
    );
  }

  async clearContext(contextId: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `DELETE FROM ${this.t("context_entries")} WHERE user_id = $1 AND context_id = $2`,
      [u, contextId]
    );
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `INSERT INTO ${this.t("invocation_logs")}
       (user_id, id, agent_id, session_id, input, output, tool_calls,
        prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
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
        entry.timestamp,
      ]
    );
  }

  async getLogs(filter?: LogFilter): Promise<InvocationLog[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    let query = `SELECT * FROM ${this.t("invocation_logs")} WHERE user_id = $1`;
    const params: unknown[] = [u];
    let paramIdx = 2;

    if (filter?.agentId) {
      query += ` AND agent_id = $${paramIdx++}`;
      params.push(filter.agentId);
    }
    if (filter?.sessionId) {
      query += ` AND session_id = $${paramIdx++}`;
      params.push(filter.sessionId);
    }
    if (filter?.since) {
      query += ` AND timestamp >= $${paramIdx++}`;
      params.push(filter.since);
    }

    query += " ORDER BY timestamp DESC";

    if (filter?.limit) {
      query += ` LIMIT $${paramIdx++}`;
      params.push(filter.limit);
    }
    if (filter?.offset) {
      query += ` OFFSET $${paramIdx++}`;
      params.push(filter.offset);
    }

    const result = await this.pool.query(query, params);
    return result.rows.map(rowToInvocationLog);
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const result = await this.pool.query(
      `SELECT * FROM ${this.t("invocation_logs")} WHERE user_id = $1 AND id = $2`,
      [u, id]
    );
    if (result.rows.length === 0) return null;
    return rowToInvocationLog(result.rows[0]);
  }

  // ═══ ProviderStore ═══

  async getProvider(id: string): Promise<ProviderConfig | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT id, api_key, base_url, config, updated_at FROM ${this.prefix}providers
       WHERE user_id = $1 AND id = $2`,
      [u, id]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      apiKey: r.api_key,
      baseUrl: r.base_url ?? undefined,
      config: r.config ?? undefined,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  }

  async listProviders(): Promise<Array<{ id: string; configured: boolean }>> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT id, api_key FROM ${this.prefix}providers WHERE user_id = $1 ORDER BY id`,
      [u]
    );
    return rows.map((r: { id: string; api_key: string }) => ({
      id: r.id,
      configured: !!r.api_key,
    }));
  }

  async putProvider(provider: ProviderConfig): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `INSERT INTO ${this.prefix}providers (user_id, id, api_key, base_url, config, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, id) DO UPDATE SET
         api_key = EXCLUDED.api_key,
         base_url = EXCLUDED.base_url,
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [u, provider.id, provider.apiKey, provider.baseUrl ?? null, provider.config ? JSON.stringify(provider.config) : null]
    );
  }

  async deleteProvider(id: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `DELETE FROM ${this.prefix}providers WHERE user_id = $1 AND id = $2`,
      [u, id]
    );
  }

  // ═══ ConnectionStore ═══

  async getConnection(kind: ConnectionKind, id: string): Promise<Connection | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT id, kind, display_name, description, config, created_at, updated_at
       FROM ${this.t("connections")}
       WHERE user_id = $1 AND kind = $2 AND id = $3`,
      [u, kind, id]
    );
    if (rows.length === 0) return null;
    return rowToConnection(rows[0]);
  }

  async listConnections(kind?: ConnectionKind): Promise<Connection[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const params: unknown[] = [u];
    let where = "WHERE user_id = $1";
    if (kind) {
      params.push(kind);
      where += " AND kind = $2";
    }
    const { rows } = await this.pool.query(
      `SELECT id, kind, display_name, description, config, created_at, updated_at
       FROM ${this.t("connections")}
       ${where}
       ORDER BY kind, id`,
      params
    );
    return rows.map(rowToConnection);
  }

  async putConnection(connection: Connection): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `INSERT INTO ${this.t("connections")}
         (user_id, kind, id, display_name, description, config, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, kind, id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         description = EXCLUDED.description,
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [
        u,
        connection.kind,
        connection.id,
        connection.displayName,
        connection.description ?? null,
        JSON.stringify(connection.config),
      ]
    );
  }

  async deleteConnection(kind: ConnectionKind, id: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `DELETE FROM ${this.t("connections")} WHERE user_id = $1 AND kind = $2 AND id = $3`,
      [u, kind, id]
    );
  }

  // ═══ RunStore ═══

  async putRun(run: Run): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `INSERT INTO ${this.t("runs")} (
          user_id, id, root_id, parent_id, agent_id, session_id,
          spawn_tool_use_id, status, input, output, result_json, error,
          started_at, ended_at, depth
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (user_id, id) DO UPDATE SET
         root_id = EXCLUDED.root_id,
         parent_id = EXCLUDED.parent_id,
         agent_id = EXCLUDED.agent_id,
         session_id = EXCLUDED.session_id,
         spawn_tool_use_id = EXCLUDED.spawn_tool_use_id,
         status = EXCLUDED.status,
         input = EXCLUDED.input,
         output = EXCLUDED.output,
         result_json = EXCLUDED.result_json,
         error = EXCLUDED.error,
         started_at = EXCLUDED.started_at,
         ended_at = EXCLUDED.ended_at,
         depth = EXCLUDED.depth`,
      [
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
        run.depth,
      ]
    );
  }

  async getRun(runId: string): Promise<Run | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT id, user_id, root_id, parent_id, agent_id, session_id,
              spawn_tool_use_id, status, input, output, result_json, error,
              started_at, ended_at, depth
       FROM ${this.t("runs")}
       WHERE user_id = $1 AND id = $2`,
      [u, runId]
    );
    if (rows.length === 0) return null;
    return rowToRun(rows[0]);
  }

  async listChildren(parentRunId: string): Promise<Run[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT id, user_id, root_id, parent_id, agent_id, session_id,
              spawn_tool_use_id, status, input, output, result_json, error,
              started_at, ended_at, depth
       FROM ${this.t("runs")}
       WHERE user_id = $1 AND parent_id = $2
       ORDER BY started_at, id`,
      [u, parentRunId]
    );
    return rows.map(rowToRun);
  }

  async listSubtree(rootId: string): Promise<Run[]> {
    await this.ensureMigrated();
    const u = this.requireUser();
    // Recursive CTE walks the parent_id graph starting at rootId.
    // Includes the root itself when present.
    const { rows } = await this.pool.query(
      `WITH RECURSIVE subtree(id) AS (
          SELECT id FROM ${this.t("runs")}
          WHERE user_id = $1 AND id = $2
          UNION ALL
          SELECT r.id FROM ${this.t("runs")} r
          INNER JOIN subtree s ON r.parent_id = s.id
          WHERE r.user_id = $1
       )
       SELECT r.id, r.user_id, r.root_id, r.parent_id, r.agent_id, r.session_id,
              r.spawn_tool_use_id, r.status, r.input, r.output, r.result_json, r.error,
              r.started_at, r.ended_at, r.depth
       FROM ${this.t("runs")} r
       INNER JOIN subtree s ON s.id = r.id
       WHERE r.user_id = $1
       ORDER BY r.depth, r.started_at, r.id`,
      [u, rootId]
    );
    return rows.map(rowToRun);
  }

  // ═══ ApiKeyStore (unscoped admin) ═══

  async createApiKey(params: { userId: string; name: string }): Promise<{ record: ApiKeyRecord; rawKey: string }> {
    await this.ensureMigrated();
    const rawKey = `ar_live_${randomBytes(24).toString("base64url")}`;
    const keyPrefix = rawKey.slice(0, 14);
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO ${this.t("api_keys")} (id, user_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, name, key_prefix, created_at, last_used_at, revoked_at`,
      [id, params.userId, params.name, keyPrefix, keyHash]
    );
    return { record: rowToApiKey(rows[0]), rawKey };
  }

  async listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
    await this.ensureMigrated();
    const { rows } = await this.pool.query(
      `SELECT id, user_id, name, key_prefix, created_at, last_used_at, revoked_at
       FROM ${this.t("api_keys")}
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(rowToApiKey);
  }

  async revokeApiKey(params: { userId: string; keyId: string }): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `UPDATE ${this.t("api_keys")} SET revoked_at = NOW()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [params.keyId, params.userId]
    );
  }

  async resolveApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null> {
    await this.ensureMigrated();
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const { rows } = await this.pool.query(
      `UPDATE ${this.t("api_keys")} SET last_used_at = NOW()
       WHERE key_hash = $1 AND revoked_at IS NULL
       RETURNING id, user_id`,
      [keyHash]
    );
    if (rows.length === 0) return null;
    return { userId: rows[0].user_id, keyId: rows[0].id };
  }

  // ═══ Lifecycle ═══

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  get pgPool(): PoolType {
    return this.pool;
  }
}

function rowToInvocationLog(r: {
  id: string;
  agent_id: string;
  session_id: string | null;
  input: string;
  output: string;
  tool_calls: unknown;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  duration: number;
  model: string;
  error: string | null;
  timestamp: Date;
}): InvocationLog {
  return {
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id ?? undefined,
    input: r.input,
    output: r.output,
    toolCalls: (typeof r.tool_calls === "string" ? JSON.parse(r.tool_calls) : r.tool_calls) as InvocationLog["toolCalls"],
    usage: {
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      totalTokens: r.total_tokens,
    },
    duration: r.duration,
    model: r.model,
    error: r.error ?? undefined,
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp),
  };
}

function rowToConnection(r: {
  id: string;
  kind: string;
  display_name: string;
  description: string | null;
  config: ConnectionConfig | string;
  created_at: Date | string;
  updated_at: Date | string;
}): Connection {
  const toIso = (v: Date | string) =>
    v instanceof Date ? v.toISOString() : String(v);
  // pg returns JSONB as already-parsed objects, but accept strings defensively.
  const cfg = typeof r.config === "string" ? JSON.parse(r.config) : r.config;
  return {
    id: r.id,
    kind: r.kind as ConnectionKind,
    displayName: r.display_name,
    description: r.description ?? undefined,
    config: cfg,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function rowToRun(r: {
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
  result_json: InvokeResult | string | null;
  error: string | null;
  started_at: string | number;
  ended_at: string | number | null;
  depth: number;
}): Run {
  const run: Run = {
    id: r.id,
    rootId: r.root_id,
    agentId: r.agent_id,
    status: r.status as RunStatus,
    input: r.input,
    // pg returns BIGINT as a string by default; normalize to number.
    startedAt: typeof r.started_at === "string" ? Number(r.started_at) : r.started_at,
    depth: r.depth,
  };
  if (r.user_id) run.userId = r.user_id;
  if (r.parent_id !== null) run.parentId = r.parent_id;
  if (r.session_id !== null) run.sessionId = r.session_id;
  if (r.spawn_tool_use_id !== null) run.spawnToolUseId = r.spawn_tool_use_id;
  if (r.error !== null) run.error = r.error;
  if (r.ended_at !== null) {
    run.endedAt = typeof r.ended_at === "string" ? Number(r.ended_at) : r.ended_at;
  }
  if (r.result_json !== null) {
    // pg returns JSONB as a parsed object; accept strings defensively.
    run.result = (typeof r.result_json === "string"
      ? JSON.parse(r.result_json)
      : r.result_json) as InvokeResult;
  }
  return run;
}

function rowToApiKey(r: {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}): ApiKeyRecord {
  const toIso = (v: Date | string | null) =>
    v == null ? null : v instanceof Date ? v.toISOString() : String(v);
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    keyPrefix: r.key_prefix,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    lastUsedAt: toIso(r.last_used_at),
    revokedAt: toIso(r.revoked_at),
  };
}
