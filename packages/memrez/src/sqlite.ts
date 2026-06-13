import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type {
	DirtyTopic,
	EntryType,
	MemoryEntry,
	MemoryStore,
	Source,
	TopicSummary,
} from "./types.js";

const MIGRATIONS = [
	`
  CREATE TABLE IF NOT EXISTS memrez_entries (
    id            TEXT PRIMARY KEY,
    scope         TEXT NOT NULL,
    content       TEXT NOT NULL,
    type          TEXT NOT NULL,
    source        TEXT,
    status        TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
    superseded_by TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memrez_entries_scope_status_updated
    ON memrez_entries(scope, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memrez_entries_updated
    ON memrez_entries(updated_at DESC);

  CREATE TABLE IF NOT EXISTS memrez_entry_topics (
    entry_id TEXT NOT NULL,
    topic    TEXT NOT NULL,
    PRIMARY KEY (entry_id, topic),
    FOREIGN KEY (entry_id) REFERENCES memrez_entries(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_memrez_entry_topics_topic
    ON memrez_entry_topics(topic, entry_id);

  CREATE TABLE IF NOT EXISTS memrez_topic_meta (
    scope           TEXT NOT NULL,
    topic           TEXT NOT NULL,
    blurb           TEXT,
    last_updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, topic)
  );

  CREATE TABLE IF NOT EXISTS memrez_schema_version (
    version INTEGER PRIMARY KEY
  );
  INSERT INTO memrez_schema_version (version) VALUES (1);
  `,
];

export interface SqliteMemoryStoreOptions {
	path: string;
	wal?: boolean;
	verbose?: boolean;
}

interface EntryRow {
	id: string;
	scope: string;
	content: string;
	type: string;
	source: string | null;
	status: "active" | "superseded";
	superseded_by: string | null;
	created_at: string;
	updated_at: string;
}

interface TopicRow {
	topic: string;
	count: number;
	last_updated_at: string;
}

interface TopicMetaRow {
	topic: string;
	blurb: string | null;
	last_updated_at: string;
}

export class SqliteMemoryStore implements MemoryStore {
	private readonly db: DatabaseType;

	constructor(options: SqliteMemoryStoreOptions | string) {
		const opts: SqliteMemoryStoreOptions =
			typeof options === "string" ? { path: options } : options;
		this.db = new Database(opts.path, {
			verbose: opts.verbose ? console.log : undefined,
		});
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("busy_timeout = 5000");
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("synchronous = NORMAL");

		if (opts.wal === false) {
			this.db.pragma("journal_mode = DELETE");
		}

		this.migrate();
	}

	close(): void {
		this.db.close();
	}

	async putEntry(entry: MemoryEntry): Promise<void> {
		const topics = Array.from(new Set(entry.topics));
		const tx = this.db.transaction(() => {
			this.db
				.prepare(
					`INSERT INTO memrez_entries (
          id, scope, content, type, source, status, superseded_by, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          scope = excluded.scope,
          content = excluded.content,
          type = excluded.type,
          source = excluded.source,
          status = excluded.status,
          superseded_by = excluded.superseded_by,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at`,
				)
				.run(
					entry.id,
					entry.scope,
					entry.content,
					entry.type,
					entry.source ? JSON.stringify(entry.source) : null,
					entry.status,
					entry.supersededBy ?? null,
					entry.createdAt,
					entry.updatedAt,
				);
			this.db
				.prepare("DELETE FROM memrez_entry_topics WHERE entry_id = ?")
				.run(entry.id);
			const insertTopic = this.db.prepare(
				"INSERT OR IGNORE INTO memrez_entry_topics (entry_id, topic) VALUES (?, ?)",
			);
			for (const topic of topics) {
				insertTopic.run(entry.id, topic);
			}
		});
		tx();
	}

	async getEntry(id: string): Promise<MemoryEntry | null> {
		const row = this.db
			.prepare("SELECT * FROM memrez_entries WHERE id = ?")
			.get(id) as EntryRow | undefined;
		return row ? this.rowToEntry(row) : null;
	}

	async supersede(ids: string[], byId: string): Promise<void> {
		if (ids.length === 0) return;
		const now = new Date().toISOString();
		const stmt = this.db.prepare(
			`UPDATE memrez_entries
       SET status = 'superseded', superseded_by = ?, updated_at = ?
       WHERE id = ?`,
		);
		const tx = this.db.transaction((entryIds: string[]) => {
			for (const id of entryIds) {
				stmt.run(byId, now, id);
			}
		});
		tx(ids);
	}

	async listTopics(scopePaths: string[]): Promise<TopicSummary[]> {
		if (scopePaths.length === 0) return [];
		const rows = this.db
			.prepare(
				`SELECT t.topic AS topic, COUNT(*) AS count, MAX(e.updated_at) AS last_updated_at,
                MAX(CASE WHEN m.last_updated_at IS NULL OR e.updated_at > m.last_updated_at THEN 1 ELSE 0 END) AS has_uncurated
         FROM memrez_entries e
         JOIN memrez_entry_topics t ON t.entry_id = e.id
         LEFT JOIN memrez_topic_meta m ON m.scope = e.scope AND m.topic = t.topic
         WHERE e.status = 'active' AND e.scope IN (${placeholders(scopePaths)})
         GROUP BY t.topic
         ORDER BY t.topic ASC`,
			)
			.all(...scopePaths) as Array<TopicRow & { has_uncurated: number }>;

		return rows.map((row) => {
			const meta = this.findTopicMeta(scopePaths, row.topic);
			return {
				topic: row.topic,
				count: row.count,
				blurb: meta?.blurb,
				lastUpdatedAt: meta?.lastUpdatedAt ?? row.last_updated_at,
				hasUncuratedWrites: row.has_uncurated === 1,
			};
		});
	}

	async getByTopic(
		scopePaths: string[],
		topic: string,
		limit = 20,
	): Promise<MemoryEntry[]> {
		if (scopePaths.length === 0) return [];
		const rows = this.db
			.prepare(
				`SELECT e.*
         FROM memrez_entries e
         JOIN memrez_entry_topics t ON t.entry_id = e.id
         WHERE e.status = 'active'
           AND e.scope IN (${placeholders(scopePaths)})
           AND t.topic = ?
         ORDER BY e.updated_at DESC
         LIMIT ?`,
			)
			.all(...scopePaths, topic, limit) as EntryRow[];
		return rows.map((row) => this.rowToEntry(row));
	}

	async getTopicMeta(
		scope: string,
		topic: string,
	): Promise<Omit<TopicSummary, "count"> | null> {
		const row = this.db
			.prepare(
				`SELECT topic, blurb, last_updated_at
         FROM memrez_topic_meta
         WHERE scope = ? AND topic = ?`,
			)
			.get(scope, topic) as TopicMetaRow | undefined;
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
		this.db
			.prepare(
				`INSERT INTO memrez_topic_meta (scope, topic, blurb, last_updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(scope, topic) DO UPDATE SET
         blurb = excluded.blurb,
         last_updated_at = excluded.last_updated_at`,
			)
			.run(
				scope,
				topic,
				meta.blurb ?? null,
				meta.lastUpdatedAt ?? new Date().toISOString(),
			);
	}

	async listScopeSlice(
		scopePaths: string[],
		opts: { topics?: string[]; includeSuperseded?: boolean } = {},
	): Promise<MemoryEntry[]> {
		if (scopePaths.length === 0) return [];
		const params: unknown[] = [...scopePaths];
		const conditions = [`e.scope IN (${placeholders(scopePaths)})`];
		if (!opts.includeSuperseded) {
			conditions.push("e.status = 'active'");
		}
		if (opts.topics?.length) {
			conditions.push(
				`EXISTS (
          SELECT 1 FROM memrez_entry_topics t
          WHERE t.entry_id = e.id AND t.topic IN (${placeholders(opts.topics)})
        )`,
			);
			params.push(...opts.topics);
		}
		const rows = this.db
			.prepare(
				`SELECT e.*
         FROM memrez_entries e
         WHERE ${conditions.join(" AND ")}
         ORDER BY e.updated_at DESC`,
			)
			.all(...params) as EntryRow[];
		return rows.map((row) => this.rowToEntry(row));
	}

	async listDirtyTopics(): Promise<DirtyTopic[]> {
		const rows = this.db
			.prepare(
				`SELECT e.scope AS scope, t.topic AS topic
         FROM memrez_entries e
         JOIN memrez_entry_topics t ON t.entry_id = e.id
         LEFT JOIN memrez_topic_meta m ON m.scope = e.scope AND m.topic = t.topic
         WHERE e.status = 'active'
         GROUP BY e.scope, t.topic, m.last_updated_at
         HAVING m.last_updated_at IS NULL OR MAX(e.updated_at) > m.last_updated_at
         ORDER BY e.scope ASC, t.topic ASC`,
			)
			.all() as Array<{ scope: string; topic: string }>;
		return rows;
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
				.prepare(
					"SELECT version FROM memrez_schema_version ORDER BY version DESC LIMIT 1",
				)
				.get() as { version: number } | undefined;
			return row?.version ?? 0;
		} catch {
			return 0;
		}
	}

	private findTopicMeta(
		scopePaths: string[],
		topic: string,
	): { blurb?: string; lastUpdatedAt: string } | null {
		const stmt = this.db.prepare(
			`SELECT blurb, last_updated_at
       FROM memrez_topic_meta
       WHERE scope = ? AND topic = ?`,
		);
		for (let i = scopePaths.length - 1; i >= 0; i--) {
			const row = stmt.get(scopePaths[i], topic) as
				| Omit<TopicMetaRow, "topic">
				| undefined;
			if (row) {
				return {
					blurb: row.blurb ?? undefined,
					lastUpdatedAt: row.last_updated_at,
				};
			}
		}
		return null;
	}

	private rowToEntry(row: EntryRow): MemoryEntry {
		const topics = this.db
			.prepare(
				"SELECT topic FROM memrez_entry_topics WHERE entry_id = ? ORDER BY topic ASC",
			)
			.all(row.id) as Array<{ topic: string }>;
		return {
			id: row.id,
			scope: row.scope,
			content: row.content,
			topics: topics.map((topic) => topic.topic),
			type: row.type as EntryType,
			source: parseSource(row.source),
			status: row.status,
			supersededBy: row.superseded_by ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}

function placeholders(values: readonly unknown[]): string {
	return values.map(() => "?").join(", ");
}

function parseSource(raw: string | null): Source | undefined {
	if (!raw) return undefined;
	return JSON.parse(raw) as Source;
}
