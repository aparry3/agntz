import pg from "pg";
import type {
  AgentDefinition,
  AgentStore,
  SessionStore,
  ContextStore,
  LogStore,
  UnifiedStore,
  Message,
  SessionSummary,
  ContextEntry,
  InvocationLog,
  LogFilter,
} from "@agent-runner/core";

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
];

// ═══════════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════════

export interface PostgresStoreOptions {
  /**
   * PostgreSQL connection. Accepts:
   * - A connection string (e.g., "postgresql://user:pass@localhost:5432/mydb")
   * - A pg.Pool instance (for sharing connections across your application)
   * - A pg.PoolConfig object
   */
  connection: string | PoolType | PoolConfig;
  /** Table name prefix. Default: "ar_" */
  tablePrefix?: string;
  /** Skip automatic migration on construction. Default: false */
  skipMigration?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// PostgreSQL Store Implementation
// ═══════════════════════════════════════════════════════════════════════

export class PostgresStore implements UnifiedStore {
  private pool: PoolType;
  private ownsPool: boolean;
  private prefix: string;
  private migrated: boolean = false;
  private migratePromise: Promise<void> | null = null;

  constructor(options: PostgresStoreOptions | string) {
    const opts: PostgresStoreOptions =
      typeof options === "string" ? { connection: options } : options;

    this.prefix = opts.tablePrefix ?? "ar_";

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

  // ═══ Table Names ═══

  private t(name: string): string {
    return `${this.prefix}${name}`;
  }

  // ═══ Migration ═══

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
      // Replace default prefix with configured prefix
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
      // Table doesn't exist yet
      return 0;
    }
  }

  // ═══ AgentStore ═══

  async getAgent(id: string): Promise<AgentDefinition | null> {
    await this.ensureMigrated();
    const result = await this.pool.query(
      `SELECT definition FROM ${this.t("agents")} WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].definition as AgentDefinition;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    await this.ensureMigrated();
    const result = await this.pool.query(
      `SELECT id, name, description FROM ${this.t("agents")} ORDER BY name`
    );
    return result.rows.map((r: { id: string; name: string; description: string | null }) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
    }));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    await this.ensureMigrated();
    const now = new Date().toISOString();
    const agentWithTimestamp = { ...agent, updatedAt: now };

    await this.pool.query(
      `INSERT INTO ${this.t("agents")} (id, name, description, version, definition, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         version = EXCLUDED.version,
         definition = EXCLUDED.definition,
         updated_at = EXCLUDED.updated_at`,
      [
        agent.id,
        agent.name,
        agent.description ?? null,
        agent.version ?? null,
        JSON.stringify(agentWithTimestamp),
        now,
        now,
      ]
    );
  }

  async deleteAgent(id: string): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `DELETE FROM ${this.t("agents")} WHERE id = $1`,
      [id]
    );
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    await this.ensureMigrated();
    const result = await this.pool.query(
      `SELECT role, content, tool_calls, tool_call_id, timestamp
       FROM ${this.t("messages")}
       WHERE session_id = $1
       ORDER BY id`,
      [sessionId]
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO ${this.t("sessions")} (id, created_at, updated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT(id) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
        [sessionId, now, now]
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM ${this.t("messages")} WHERE session_id = $1`,
        [sessionId]
      );
      await client.query(
        `DELETE FROM ${this.t("sessions")} WHERE id = $1`,
        [sessionId]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    await this.ensureMigrated();
    let query = `
      SELECT s.id, s.agent_id, s.created_at, s.updated_at,
             COUNT(m.id) as message_count
      FROM ${this.t("sessions")} s
      LEFT JOIN ${this.t("messages")} m ON m.session_id = s.id
    `;
    const params: string[] = [];

    if (agentId) {
      query += " WHERE s.agent_id = $1";
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
    const result = await this.pool.query(
      `SELECT context_id, agent_id, invocation_id, content, created_at
       FROM ${this.t("context_entries")}
       WHERE context_id = $1
       ORDER BY id`,
      [contextId]
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
    await this.pool.query(
      `INSERT INTO ${this.t("context_entries")} (context_id, agent_id, invocation_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [contextId, entry.agentId, entry.invocationId, entry.content, entry.createdAt]
    );
  }

  async clearContext(contextId: string): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `DELETE FROM ${this.t("context_entries")} WHERE context_id = $1`,
      [contextId]
    );
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `INSERT INTO ${this.t("invocation_logs")}
       (id, agent_id, session_id, input, output, tool_calls,
        prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
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
    let query = `SELECT * FROM ${this.t("invocation_logs")} WHERE 1=1`;
    const params: unknown[] = [];
    let paramIdx = 1;

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

    return result.rows.map((r: {
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
    }) => ({
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
    }));
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    await this.ensureMigrated();
    const result = await this.pool.query(
      `SELECT * FROM ${this.t("invocation_logs")} WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const r = result.rows[0] as {
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
    };

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

  // ═══ Lifecycle ═══

  /** Close the pool (only if we own it). Call this on shutdown. */
  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  /** Get the underlying pg.Pool instance for advanced use. */
  get pgPool(): PoolType {
    return this.pool;
  }
}
