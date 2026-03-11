import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
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

// ═══════════════════════════════════════════════════════════════════════
// Schema Migrations
// ═══════════════════════════════════════════════════════════════════════

const MIGRATIONS = [
  // v1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT,
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

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
];

// ═══════════════════════════════════════════════════════════════════════
// Options
// ═══════════════════════════════════════════════════════════════════════

export interface SqliteStoreOptions {
  /** Path to SQLite database file. Use ":memory:" for in-memory. */
  path: string;
  /** Enable WAL mode for better concurrent read performance. Default: true */
  wal?: boolean;
  /** Enable verbose logging. Default: false */
  verbose?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════
// SQLite Store Implementation
// ═══════════════════════════════════════════════════════════════════════

export class SqliteStore implements UnifiedStore {
  private db: DatabaseType;

  constructor(options: SqliteStoreOptions | string) {
    const opts: SqliteStoreOptions =
      typeof options === "string" ? { path: options } : options;

    this.db = new Database(opts.path, {
      verbose: opts.verbose ? console.log : undefined,
    });

    // Performance pragmas
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    if (opts.wal === false) {
      this.db.pragma("journal_mode = DELETE");
    }

    this.migrate();
  }

  // ═══ Migration ═══

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
      // Table doesn't exist yet
      return 0;
    }
  }

  // ═══ AgentStore ═══

  async getAgent(id: string): Promise<AgentDefinition | null> {
    const row = this.db
      .prepare("SELECT definition FROM agents WHERE id = ?")
      .get(id) as { definition: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.definition) as AgentDefinition;
  }

  async listAgents(): Promise<Array<{ id: string; name: string; description?: string }>> {
    const rows = this.db
      .prepare("SELECT id, name, description FROM agents ORDER BY name")
      .all() as Array<{ id: string; name: string; description: string | null }>;

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? undefined,
    }));
  }

  async putAgent(agent: AgentDefinition): Promise<void> {
    const now = new Date().toISOString();
    const agentWithTimestamp = { ...agent, updatedAt: now };

    this.db
      .prepare(
        `INSERT INTO agents (id, name, description, version, definition, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           version = excluded.version,
           definition = excluded.definition,
           updated_at = excluded.updated_at`
      )
      .run(
        agent.id,
        agent.name,
        agent.description ?? null,
        agent.version ?? null,
        JSON.stringify(agentWithTimestamp),
        now,
        now
      );
  }

  async deleteAgent(id: string): Promise<void> {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  // ═══ SessionStore ═══

  async getMessages(sessionId: string): Promise<Message[]> {
    const rows = this.db
      .prepare(
        "SELECT role, content, tool_calls, tool_call_id, timestamp FROM messages WHERE session_id = ? ORDER BY id"
      )
      .all(sessionId) as Array<{
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
    const now = new Date().toISOString();

    const upsertSession = this.db.prepare(
      `INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`
    );

    const insertMsg = this.db.prepare(
      `INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction(() => {
      upsertSession.run(sessionId, now, now);
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
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    });
    transaction();
  }

  async listSessions(agentId?: string): Promise<SessionSummary[]> {
    let query = `
      SELECT s.id, s.agent_id, s.created_at, s.updated_at,
             COUNT(m.id) as message_count
      FROM sessions s
      LEFT JOIN messages m ON m.session_id = s.id
    `;
    const params: string[] = [];

    if (agentId) {
      query += " WHERE s.agent_id = ?";
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
    const rows = this.db
      .prepare(
        "SELECT context_id, agent_id, invocation_id, content, created_at FROM context_entries WHERE context_id = ? ORDER BY id"
      )
      .all(contextId) as Array<{
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
    this.db
      .prepare(
        `INSERT INTO context_entries (context_id, agent_id, invocation_id, content, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        contextId,
        entry.agentId,
        entry.invocationId,
        entry.content,
        entry.createdAt
      );
  }

  async clearContext(contextId: string): Promise<void> {
    this.db
      .prepare("DELETE FROM context_entries WHERE context_id = ?")
      .run(contextId);
  }

  // ═══ LogStore ═══

  async log(entry: InvocationLog): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO invocation_logs (id, agent_id, session_id, input, output, tool_calls,
          prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
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
    let query = "SELECT * FROM invocation_logs WHERE 1=1";
    const params: unknown[] = [];

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

    const rows = this.db.prepare(query).all(...params) as Array<{
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
    }>;

    return rows.map((r) => ({
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
    }));
  }

  async getLog(id: string): Promise<InvocationLog | null> {
    const row = this.db
      .prepare("SELECT * FROM invocation_logs WHERE id = ?")
      .get(id) as {
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
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      agentId: row.agent_id,
      sessionId: row.session_id ?? undefined,
      input: row.input,
      output: row.output,
      toolCalls: JSON.parse(row.tool_calls),
      usage: {
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
      },
      duration: row.duration,
      model: row.model,
      error: row.error ?? undefined,
      timestamp: row.timestamp,
    };
  }

  // ═══ Lifecycle ═══

  /** Close the database connection. Call this on shutdown. */
  close(): void {
    this.db.close();
  }

  /** Get the underlying better-sqlite3 Database instance for advanced use. */
  get database(): DatabaseType {
    return this.db;
  }
}
