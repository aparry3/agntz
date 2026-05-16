import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { defineSkill } from "@agntz/core";
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
  RunListFilters,
  RunListResult,
  SkillDefinition,
  Span,
  TraceSummary,
  TraceFilter,
} from "@agntz/core";

const { Pool } = pg;
type PoolType = InstanceType<typeof pg.Pool>;
type PoolConfig = pg.PoolConfig;
type PoolClientType = pg.PoolClient;

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
  INSERT INTO ar_schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;
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
  CREATE INDEX IF NOT EXISTS idx_ar_runs_started ON ar_runs(user_id, started_at DESC);

  UPDATE ar_schema_version SET version = 6;
  `,
  // v7: Traces — span trees for observability. Two tables: spans (row per
  // span, one trace = many rows) and trace_summaries (precomputed roll-up).
  `
  CREATE TABLE IF NOT EXISTS ar_spans (
    span_id      TEXT PRIMARY KEY,
    trace_id     TEXT NOT NULL,
    parent_id    TEXT,
    owner_id     TEXT NOT NULL,
    run_id       TEXT,
    session_id   TEXT,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('run','manifest','step','invoke','model','tool')),
    started_at   TIMESTAMPTZ NOT NULL,
    ended_at     TIMESTAMPTZ,
    duration_ms  INTEGER,
    status       TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
    error        TEXT,
    attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
    events       JSONB NOT NULL DEFAULT '[]'::jsonb,
    scores       JSONB NOT NULL DEFAULT '{}'::jsonb,
    cost_usd     NUMERIC(12,6)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_started
    ON ar_spans (owner_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_trace ON ar_spans (trace_id);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_parent
    ON ar_spans (parent_id) WHERE parent_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_name_started
    ON ar_spans (owner_id, name, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_run
    ON ar_spans (owner_id, run_id) WHERE run_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS ar_trace_summaries (
    trace_id       TEXT PRIMARY KEY,
    owner_id       TEXT NOT NULL,
    root_name      TEXT NOT NULL,
    agent_id       TEXT,
    started_at     TIMESTAMPTZ NOT NULL,
    ended_at       TIMESTAMPTZ,
    duration_ms    INTEGER,
    span_count     INTEGER NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
    total_tokens   INTEGER NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(12,6)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_started
    ON ar_trace_summaries (owner_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_agent
    ON ar_trace_summaries (owner_id, agent_id) WHERE agent_id IS NOT NULL;

  UPDATE ar_schema_version SET version = 7;
  `,
  // v8: Skills — reusable (instruction + tools) bundles per user.
  // Composite PK on (user_id, name); same skill name may exist for different users.
  `
  CREATE TABLE IF NOT EXISTS ar_skills (
    user_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL,
    instructions TEXT NOT NULL,
    tools        JSONB,
    metadata     JSONB,
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_skills_user ON ar_skills(user_id);

  UPDATE ar_schema_version SET version = 8;
  `,
  // v9: ar_invocation_logs.status — records terminal state
  // ("completed" | "cancelled" | "failed") for billing/audit when a run is
  // superseded by cancel-and-replace.
  `
  ALTER TABLE ar_invocation_logs ADD COLUMN IF NOT EXISTS status TEXT;

  UPDATE ar_schema_version SET version = 9;
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
      // Mark the promise as handled so a migration failure doesn't crash the
      // process as an unhandled rejection. ensureMigrated() awaits the same
      // promise and will surface the error on the first real operation.
      this.migratePromise.catch(() => {});
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
    // Hold a single connection so the advisory lock and migration queries
    // run on the same session — pg_advisory_lock is session-scoped.
    const client = await this.pool.connect();
    try {
      const lockKey = this.migrationLockKey();
      // Serializes migrations across all processes sharing this database
      // (e.g., app + worker booting concurrently on Railway).
      await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
      try {
        const currentVersion = await this.getSchemaVersion(client);
        // Heal stale rows from prior failed/racing migrations: schema_version
        // is meant to hold exactly one row, but if v1's INSERT ever ran twice
        // (pre-fix code) the table can have multiple rows, which then breaks
        // every "UPDATE ar_schema_version SET version = N" (PK conflict).
        if (currentVersion > 0) {
          await client.query(
            `DELETE FROM ${this.t("schema_version")} WHERE version < $1`,
            [currentVersion]
          );
        }
        for (let i = currentVersion; i < MIGRATIONS.length; i++) {
          const sql = MIGRATIONS[i].replace(/ar_/g, this.prefix);
          await client.query(sql);
        }
        this.migrated = true;
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
      }
    } finally {
      client.release();
    }
  }

  private migrationLockKey(): string {
    const hash = createHash("sha256")
      .update(`agntz-migration:${this.prefix}`)
      .digest();
    return hash.readBigInt64BE(0).toString();
  }

  private async getSchemaVersion(
    executor: PoolType | PoolClientType = this.pool
  ): Promise<number> {
    try {
      const result = await executor.query(
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

  async getOrCreateSession(sessionId: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    // Ownership check: avoid silently aliasing the id under a different user.
    const existing = await this.pool.query(
      `SELECT user_id FROM ${this.t("sessions")} WHERE id = $1`,
      [sessionId]
    );
    if (existing.rows.length > 0 && existing.rows[0].user_id !== u) {
      throw new Error(`Session ${sessionId} belongs to a different user`);
    }
    await this.pool.query(
      `INSERT INTO ${this.t("sessions")} (id, user_id, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, u]
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
        prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
        entry.status ?? null,
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

  async listRuns(filters: RunListFilters): Promise<RunListResult> {
    await this.ensureMigrated();
    const u = this.requireUser();

    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const rootsOnly = filters.rootsOnly ?? true;
    const clauses: string[] = ["user_id = $1"];
    const args: unknown[] = [u];
    let i = 2;

    if (rootsOnly) clauses.push("parent_id IS NULL");
    if (filters.agentId) { clauses.push(`agent_id = $${i++}`); args.push(filters.agentId); }
    if (filters.status) { clauses.push(`status = $${i++}`); args.push(filters.status); }
    if (filters.startedAfter) {
      const t = Date.parse(filters.startedAfter);
      if (Number.isFinite(t)) { clauses.push(`started_at >= $${i++}`); args.push(t); }
    }
    if (filters.startedBefore) {
      const t = Date.parse(filters.startedBefore);
      if (Number.isFinite(t)) { clauses.push(`started_at <= $${i++}`); args.push(t); }
    }
    if (filters.cursor) {
      const c = decodeRunCursor(filters.cursor);
      if (c) {
        clauses.push(`(started_at < $${i} OR (started_at = $${i} AND id < $${i + 1}))`);
        args.push(c.startedAt, c.id);
        i += 2;
      }
    }

    args.push(limit + 1);
    const sql = `SELECT * FROM ${this.t("runs")}
                 WHERE ${clauses.join(" AND ")}
                 ORDER BY started_at DESC, id DESC
                 LIMIT $${i}`;
    const { rows: raw } = await this.pool.query<Record<string, unknown>>(sql, args);
    const hasMore = raw.length > limit;
    const page = hasMore ? raw.slice(0, limit) : raw;
    const rows = page.map((r) => rowToRun(r as Parameters<typeof rowToRun>[0]));

    return {
      rows,
      cursor: hasMore
        ? encodeRunCursor({
            startedAt: rows[rows.length - 1].startedAt,
            id: rows[rows.length - 1].id,
          })
        : undefined,
    };
  }

  // ═══ TraceStore ═══

  async insertSpan(span: Span): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `INSERT INTO ${this.t("spans")} (
        span_id, trace_id, parent_id, owner_id, run_id, session_id,
        name, kind, started_at, ended_at, duration_ms, status, error,
        attributes, events, scores, cost_usd
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (span_id) DO UPDATE SET
        trace_id    = EXCLUDED.trace_id,
        parent_id   = EXCLUDED.parent_id,
        owner_id    = EXCLUDED.owner_id,
        run_id      = EXCLUDED.run_id,
        session_id  = EXCLUDED.session_id,
        name        = EXCLUDED.name,
        kind        = EXCLUDED.kind,
        started_at  = EXCLUDED.started_at,
        ended_at    = EXCLUDED.ended_at,
        duration_ms = EXCLUDED.duration_ms,
        status      = EXCLUDED.status,
        error       = EXCLUDED.error,
        attributes  = EXCLUDED.attributes,
        events      = EXCLUDED.events,
        scores      = EXCLUDED.scores,
        cost_usd    = EXCLUDED.cost_usd`,
      [
        span.spanId, span.traceId, span.parentId ?? null, span.ownerId, span.runId ?? null, span.sessionId ?? null,
        span.name, span.kind, span.startedAt, span.endedAt ?? null, span.durationMs ?? null, span.status, span.error ?? null,
        JSON.stringify(span.attributes), JSON.stringify(span.events), JSON.stringify(span.scores),
        span.costUsd ?? null,
      ]
    );
  }

  async insertSpansBatch(spans: Span[]): Promise<void> {
    if (spans.length === 0) return;
    await this.ensureMigrated();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const s of spans) {
        await client.query(
          `INSERT INTO ${this.t("spans")} (
            span_id, trace_id, parent_id, owner_id, run_id, session_id,
            name, kind, started_at, ended_at, duration_ms, status, error,
            attributes, events, scores, cost_usd
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (span_id) DO NOTHING`,
          [
            s.spanId, s.traceId, s.parentId ?? null, s.ownerId, s.runId ?? null, s.sessionId ?? null,
            s.name, s.kind, s.startedAt, s.endedAt ?? null, s.durationMs ?? null, s.status, s.error ?? null,
            JSON.stringify(s.attributes), JSON.stringify(s.events), JSON.stringify(s.scores),
            s.costUsd ?? null,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void> {
    await this.ensureMigrated();
    const sets: string[] = [];
    const args: unknown[] = [];
    let i = 1;
    if ("endedAt" in patch) { sets.push(`ended_at = $${i++}`); args.push(patch.endedAt ?? null); }
    if ("durationMs" in patch) { sets.push(`duration_ms = $${i++}`); args.push(patch.durationMs ?? null); }
    if ("status" in patch) { sets.push(`status = $${i++}`); args.push(patch.status); }
    if ("error" in patch) { sets.push(`error = $${i++}`); args.push(patch.error ?? null); }
    if ("attributes" in patch) { sets.push(`attributes = $${i++}`); args.push(JSON.stringify(patch.attributes)); }
    if ("events" in patch) { sets.push(`events = $${i++}`); args.push(JSON.stringify(patch.events)); }
    if ("scores" in patch) { sets.push(`scores = $${i++}`); args.push(JSON.stringify(patch.scores)); }
    if ("costUsd" in patch) { sets.push(`cost_usd = $${i++}`); args.push(patch.costUsd ?? null); }
    if (sets.length === 0) return;
    args.push(spanId, ownerId);
    await this.pool.query(
      `UPDATE ${this.t("spans")} SET ${sets.join(", ")}
       WHERE span_id = $${i++} AND owner_id = $${i++}`,
      args
    );
  }

  async upsertSummary(summary: TraceSummary): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `INSERT INTO ${this.t("trace_summaries")} (
        trace_id, owner_id, root_name, agent_id, started_at, ended_at,
        duration_ms, span_count, status, total_tokens, total_cost_usd
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (trace_id) DO UPDATE SET
        owner_id       = EXCLUDED.owner_id,
        root_name      = EXCLUDED.root_name,
        agent_id       = EXCLUDED.agent_id,
        started_at     = EXCLUDED.started_at,
        ended_at       = EXCLUDED.ended_at,
        duration_ms    = EXCLUDED.duration_ms,
        span_count     = EXCLUDED.span_count,
        status         = EXCLUDED.status,
        total_tokens   = EXCLUDED.total_tokens,
        total_cost_usd = EXCLUDED.total_cost_usd`,
      [
        summary.traceId, summary.ownerId, summary.rootName, summary.agentId ?? null,
        summary.startedAt, summary.endedAt ?? null, summary.durationMs ?? null, summary.spanCount,
        summary.status, summary.totalTokens, summary.totalCostUsd ?? null,
      ]
    );
  }

  async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
    await this.ensureMigrated();
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.t("spans")}
       WHERE trace_id = $1 AND owner_id = $2
       ORDER BY started_at ASC, span_id ASC`,
      [traceId, ownerId]
    );
    return rows.map(pgRowToSpan);
  }

  async getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null> {
    await this.ensureMigrated();
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.t("trace_summaries")}
       WHERE trace_id = $1 AND owner_id = $2`,
      [traceId, ownerId]
    );
    return rows.length === 0 ? null : pgRowToSummary(rows[0]);
  }

  async listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }> {
    await this.ensureMigrated();
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const clauses = [`owner_id = $1`];
    const args: unknown[] = [filter.ownerId];
    let i = 2;
    if (filter.agentId) { clauses.push(`agent_id = $${i++}`); args.push(filter.agentId); }
    if (filter.status) { clauses.push(`status = $${i++}`); args.push(filter.status); }
    if (filter.startedAfter) { clauses.push(`started_at >= $${i++}`); args.push(filter.startedAfter); }
    if (filter.startedBefore) { clauses.push(`started_at <= $${i++}`); args.push(filter.startedBefore); }
    if (filter.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8")) as {
          startedAt: string;
          traceId: string;
        };
        clauses.push(
          `(started_at < $${i} OR (started_at = $${i} AND trace_id < $${i + 1}))`
        );
        args.push(decoded.startedAt, decoded.traceId);
        i += 2;
      } catch {
        // ignore bad cursor — silent restart from page 1
      }
    }
    args.push(limit);
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.t("trace_summaries")}
       WHERE ${clauses.join(" AND ")}
       ORDER BY started_at DESC, trace_id DESC
       LIMIT $${i}`,
      args
    );
    const summaries = rows.map(pgRowToSummary);
    const cursor =
      summaries.length === limit
        ? Buffer.from(
            JSON.stringify({
              startedAt: summaries[summaries.length - 1].startedAt,
              traceId: summaries[summaries.length - 1].traceId,
            })
          ).toString("base64url")
        : undefined;
    return { rows: summaries, cursor };
  }

  async deleteTrace(traceId: string, ownerId: string): Promise<void> {
    await this.ensureMigrated();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM ${this.t("spans")} WHERE trace_id = $1 AND owner_id = $2`,
        [traceId, ownerId]
      );
      await client.query(
        `DELETE FROM ${this.t("trace_summaries")} WHERE trace_id = $1 AND owner_id = $2`,
        [traceId, ownerId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
    await this.ensureMigrated();
    const beforeIso = before.toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: tids } = await client.query(
        `SELECT trace_id FROM ${this.t("trace_summaries")}
         WHERE owner_id = $1 AND started_at < $2`,
        [ownerId, beforeIso]
      );
      const traceIds: string[] = tids.map((r: { trace_id: string }) => r.trace_id);
      if (traceIds.length > 0) {
        await client.query(
          `DELETE FROM ${this.t("spans")}
           WHERE owner_id = $1 AND trace_id = ANY($2::text[])`,
          [ownerId, traceIds]
        );
        await client.query(
          `DELETE FROM ${this.t("trace_summaries")}
           WHERE owner_id = $1 AND trace_id = ANY($2::text[])`,
          [ownerId, traceIds]
        );
      }
      await client.query("COMMIT");
      return traceIds.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ═══ SkillStore ═══

  async getSkill(name: string): Promise<SkillDefinition | null> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT name, description, instructions, tools, metadata, created_at, updated_at
       FROM ${this.t("skills")}
       WHERE user_id = $1 AND name = $2`,
      [u, name]
    );
    return rows.length === 0 ? null : pgRowToSkill(rows[0]);
  }

  async listSkills(): Promise<Array<{ name: string; description: string }>> {
    await this.ensureMigrated();
    const u = this.requireUser();
    const { rows } = await this.pool.query(
      `SELECT name, description FROM ${this.t("skills")}
       WHERE user_id = $1 ORDER BY name`,
      [u]
    );
    return rows.map((r: { name: string; description: string }) => ({
      name: r.name,
      description: r.description,
    }));
  }

  async putSkill(skill: SkillDefinition): Promise<void> {
    // Structural validation before persisting; throws on malformed input.
    const validated = defineSkill(skill);
    await this.ensureMigrated();
    const u = this.requireUser();
    const now = this.nextTimestamp();
    const createdAt = validated.createdAt ?? now;
    await this.pool.query(
      `INSERT INTO ${this.t("skills")}
         (user_id, name, description, instructions, tools, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, name) DO UPDATE SET
         description = EXCLUDED.description,
         instructions = EXCLUDED.instructions,
         tools = EXCLUDED.tools,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        u,
        validated.name,
        validated.description,
        validated.instructions,
        validated.tools ? JSON.stringify(validated.tools) : null,
        validated.metadata ? JSON.stringify(validated.metadata) : null,
        createdAt,
        now,
      ]
    );
  }

  async deleteSkill(name: string): Promise<void> {
    await this.ensureMigrated();
    const u = this.requireUser();
    await this.pool.query(
      `DELETE FROM ${this.t("skills")} WHERE user_id = $1 AND name = $2`,
      [u, name]
    );
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
  status?: string | null;
}): InvocationLog {
  const log: InvocationLog = {
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
  if (r.status) log.status = r.status as InvocationLog["status"];
  return log;
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

function pgRowToSpan(r: Record<string, unknown>): Span {
  return {
    spanId: r.span_id as string,
    traceId: r.trace_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    ownerId: r.owner_id as string,
    runId: (r.run_id as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    name: r.name as string,
    kind: r.kind as Span["kind"],
    startedAt:
      r.started_at instanceof Date
        ? (r.started_at as Date).toISOString()
        : (r.started_at as string),
    endedAt:
      r.ended_at == null
        ? null
        : r.ended_at instanceof Date
          ? (r.ended_at as Date).toISOString()
          : (r.ended_at as string),
    durationMs: (r.duration_ms as number | null) ?? null,
    status: r.status as Span["status"],
    error: (r.error as string | null) ?? null,
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    events: (r.events as Span["events"]) ?? [],
    scores: (r.scores as Span["scores"]) ?? {},
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
  };
}

function pgRowToSkill(r: {
  name: string;
  description: string;
  instructions: string;
  tools: unknown;
  metadata: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}): SkillDefinition {
  const toIso = (v: Date | string) =>
    v instanceof Date ? v.toISOString() : String(v);
  const skill: SkillDefinition = {
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
  // pg returns JSONB pre-parsed; accept strings defensively.
  if (r.tools != null) {
    skill.tools = (typeof r.tools === "string"
      ? JSON.parse(r.tools)
      : r.tools) as SkillDefinition["tools"];
  }
  if (r.metadata != null) {
    skill.metadata = (typeof r.metadata === "string"
      ? JSON.parse(r.metadata)
      : r.metadata) as Record<string, unknown>;
  }
  return skill;
}

function pgRowToSummary(r: Record<string, unknown>): TraceSummary {
  return {
    traceId: r.trace_id as string,
    ownerId: r.owner_id as string,
    rootName: r.root_name as string,
    agentId: (r.agent_id as string | null) ?? null,
    startedAt:
      r.started_at instanceof Date
        ? (r.started_at as Date).toISOString()
        : (r.started_at as string),
    endedAt:
      r.ended_at == null
        ? null
        : r.ended_at instanceof Date
          ? (r.ended_at as Date).toISOString()
          : (r.ended_at as string),
    durationMs: (r.duration_ms as number | null) ?? null,
    spanCount: r.span_count as number,
    status: r.status as TraceSummary["status"],
    totalTokens: r.total_tokens as number,
    totalCostUsd: r.total_cost_usd == null ? null : Number(r.total_cost_usd),
  };
}

function encodeRunCursor(c: { startedAt: number; id: string }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeRunCursor(s: string): { startedAt: number; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "startedAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as { startedAt: unknown }).startedAt === "number" &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return parsed as { startedAt: number; id: string };
    }
    return null;
  } catch {
    return null;
  }
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
