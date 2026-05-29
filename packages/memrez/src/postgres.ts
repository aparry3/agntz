import pg from "pg";
import type { EntryType, MemoryEntry, MemoryStore, Source, TopicSummary } from "./types.js";

const { Pool } = pg;
type PoolType = InstanceType<typeof pg.Pool>;
type PoolConfig = pg.PoolConfig;
type PoolClientType = pg.PoolClient;

export interface PostgresMemoryStoreOptions {
  connection: string | PoolConfig | PoolType;
  tablePrefix?: string;
  runMigrations?: boolean;
}

interface EntryRow {
  id: string;
  scope: string;
  content: string;
  type: string;
  source: Source | string | null;
  status: "active" | "superseded";
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TopicRow {
  topic: string;
  count: string | number;
  last_updated_at: string;
}

interface TopicMetaRow {
  blurb: string | null;
  last_updated_at: string;
}

export class PostgresMemoryStore implements MemoryStore {
  private readonly pool: PoolType;
  private readonly ownedPool: boolean;
  private readonly prefix: string;
  private readonly ready: Promise<void>;

  constructor(options: PostgresMemoryStoreOptions | string) {
    const opts: PostgresMemoryStoreOptions =
      typeof options === "string" ? { connection: options } : options;
    this.prefix = normalizeTablePrefix(opts.tablePrefix);
    if (typeof opts.connection === "string") {
      this.pool = new Pool({ connectionString: opts.connection });
      this.ownedPool = true;
    } else if ("query" in opts.connection && "connect" in opts.connection) {
      this.pool = opts.connection as PoolType;
      this.ownedPool = false;
    } else {
      this.pool = new Pool(opts.connection);
      this.ownedPool = true;
    }
    this.ready = opts.runMigrations === false ? Promise.resolve() : this.migrate();
    this.ready.catch(() => {});
  }

  async close(): Promise<void> {
    if (this.ownedPool) {
      await this.pool.end();
    }
  }

  async putEntry(entry: MemoryEntry): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO ${this.table("entries")} (
          id, scope, content, type, source, status, superseded_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          content = excluded.content,
          type = excluded.type,
          source = excluded.source,
          status = excluded.status,
          superseded_by = excluded.superseded_by,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
        [
          entry.id,
          entry.scope,
          entry.content,
          entry.type,
          entry.source ? JSON.stringify(entry.source) : null,
          entry.status,
          entry.supersededBy ?? null,
          entry.createdAt,
          entry.updatedAt,
        ],
      );
      await client.query(`DELETE FROM ${this.table("entry_topics")} WHERE entry_id = $1`, [
        entry.id,
      ]);
      for (const topic of Array.from(new Set(entry.topics))) {
        await client.query(
          `INSERT INTO ${this.table("entry_topics")} (entry_id, topic)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [entry.id, topic],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getEntry(id: string): Promise<MemoryEntry | null> {
    await this.ready;
    const result = await this.pool.query<EntryRow>(
      `SELECT * FROM ${this.table("entries")} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? await this.rowToEntry(result.rows[0]) : null;
  }

  async supersede(ids: string[], byId: string): Promise<void> {
    await this.ready;
    if (ids.length === 0) return;
    await this.pool.query(
      `UPDATE ${this.table("entries")}
       SET status = 'superseded', superseded_by = $1, updated_at = $2
       WHERE id = ANY($3::text[])`,
      [byId, new Date().toISOString(), ids],
    );
  }

  async listTopics(scopePaths: string[]): Promise<TopicSummary[]> {
    await this.ready;
    if (scopePaths.length === 0) return [];
    const result = await this.pool.query<TopicRow>(
      `SELECT t.topic AS topic, COUNT(*) AS count, MAX(e.updated_at) AS last_updated_at
       FROM ${this.table("entries")} e
       JOIN ${this.table("entry_topics")} t ON t.entry_id = e.id
       WHERE e.status = 'active' AND e.scope = ANY($1::text[])
       GROUP BY t.topic
       ORDER BY t.topic ASC`,
      [scopePaths],
    );

    return Promise.all(result.rows.map(async (row) => {
      const meta = await this.findTopicMeta(scopePaths, row.topic);
      return {
        topic: row.topic,
        count: Number(row.count),
        blurb: meta?.blurb ?? undefined,
        lastUpdatedAt: meta?.last_updated_at ?? row.last_updated_at,
        hasUncuratedWrites: true,
      };
    }));
  }

  async getByTopic(scopePaths: string[], topic: string, limit = 20): Promise<MemoryEntry[]> {
    await this.ready;
    if (scopePaths.length === 0) return [];
    const result = await this.pool.query<EntryRow>(
      `SELECT e.*
       FROM ${this.table("entries")} e
       JOIN ${this.table("entry_topics")} t ON t.entry_id = e.id
       WHERE e.status = 'active'
         AND e.scope = ANY($1::text[])
         AND t.topic = $2
       ORDER BY e.updated_at DESC
       LIMIT $3`,
      [scopePaths, topic, limit],
    );
    return Promise.all(result.rows.map((row) => this.rowToEntry(row)));
  }

  async getTopicMeta(scope: string, topic: string): Promise<Omit<TopicSummary, "count"> | null> {
    await this.ready;
    const result = await this.pool.query<{ topic: string; blurb: string | null; last_updated_at: string }>(
      `SELECT topic, blurb, last_updated_at
       FROM ${this.table("topic_meta")}
       WHERE scope = $1 AND topic = $2`,
      [scope, topic],
    );
    const row = result.rows[0];
    return row
      ? {
          topic: row.topic,
          blurb: row.blurb ?? undefined,
          lastUpdatedAt: row.last_updated_at,
          hasUncuratedWrites: false,
        }
      : null;
  }

  async setTopicMeta(
    scope: string,
    topic: string,
    meta: { blurb?: string; lastUpdatedAt?: string },
  ): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO ${this.table("topic_meta")} (scope, topic, blurb, last_updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(scope, topic) DO UPDATE SET
         blurb = excluded.blurb,
         last_updated_at = excluded.last_updated_at`,
      [scope, topic, meta.blurb ?? null, meta.lastUpdatedAt ?? new Date().toISOString()],
    );
  }

  async listScopeSlice(
    scopePaths: string[],
    opts: { topics?: string[]; includeSuperseded?: boolean } = {},
  ): Promise<MemoryEntry[]> {
    await this.ready;
    if (scopePaths.length === 0) return [];
    const conditions = ["e.scope = ANY($1::text[])"];
    const params: unknown[] = [scopePaths];
    if (!opts.includeSuperseded) {
      conditions.push("e.status = 'active'");
    }
    if (opts.topics?.length) {
      params.push(opts.topics);
      conditions.push(
        `EXISTS (
          SELECT 1 FROM ${this.table("entry_topics")} t
          WHERE t.entry_id = e.id AND t.topic = ANY($${params.length}::text[])
        )`,
      );
    }
    const result = await this.pool.query<EntryRow>(
      `SELECT e.*
       FROM ${this.table("entries")} e
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.updated_at DESC`,
      params,
    );
    return Promise.all(result.rows.map((row) => this.rowToEntry(row)));
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table("entries")} (
        id            TEXT PRIMARY KEY,
        scope         TEXT NOT NULL,
        content       TEXT NOT NULL,
        type          TEXT NOT NULL,
        source        JSONB,
        status        TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
        superseded_by TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ${this.index("entries_scope_status_updated")}
        ON ${this.table("entries")}(scope, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS ${this.index("entries_updated")}
        ON ${this.table("entries")}(updated_at DESC);

      CREATE TABLE IF NOT EXISTS ${this.table("entry_topics")} (
        entry_id TEXT NOT NULL REFERENCES ${this.table("entries")}(id) ON DELETE CASCADE,
        topic    TEXT NOT NULL,
        PRIMARY KEY (entry_id, topic)
      );
      CREATE INDEX IF NOT EXISTS ${this.index("entry_topics_topic")}
        ON ${this.table("entry_topics")}(topic, entry_id);

      CREATE TABLE IF NOT EXISTS ${this.table("topic_meta")} (
        scope           TEXT NOT NULL,
        topic           TEXT NOT NULL,
        blurb           TEXT,
        last_updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, topic)
      );

      CREATE TABLE IF NOT EXISTS ${this.table("schema_version")} (
        version INTEGER PRIMARY KEY
      );
      INSERT INTO ${this.table("schema_version")} (version)
      VALUES (1)
      ON CONFLICT DO NOTHING;
    `);
  }

  private async rowToEntry(row: EntryRow): Promise<MemoryEntry> {
    const topics = await this.pool.query<{ topic: string }>(
      `SELECT topic FROM ${this.table("entry_topics")} WHERE entry_id = $1 ORDER BY topic ASC`,
      [row.id],
    );
    return {
      id: row.id,
      scope: row.scope,
      content: row.content,
      topics: topics.rows.map((topic) => topic.topic),
      type: row.type as EntryType,
      source: parseSource(row.source),
      status: row.status,
      supersededBy: row.superseded_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async findTopicMeta(scopePaths: string[], topic: string): Promise<TopicMetaRow | null> {
    const result = await this.pool.query<TopicMetaRow>(
      `SELECT blurb, last_updated_at
       FROM ${this.table("topic_meta")}
       WHERE scope = ANY($1::text[]) AND topic = $2
       ORDER BY array_position($1::text[], scope) DESC
       LIMIT 1`,
      [scopePaths, topic],
    );
    return result.rows[0] ?? null;
  }

  private table(name: string): string {
    return quoteIdentifier(`${this.prefix}memrez_${name}`);
  }

  private index(name: string): string {
    return quoteIdentifier(`${this.prefix}idx_memrez_${name}`);
  }
}

function normalizeTablePrefix(prefix: string | undefined): string {
  if (!prefix) return "";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) {
    throw new Error("PostgresMemoryStore tablePrefix must be a valid identifier prefix");
  }
  return prefix;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseSource(raw: Source | string | null): Source | undefined {
  if (!raw) return undefined;
  if (typeof raw === "string") return JSON.parse(raw) as Source;
  return raw;
}
