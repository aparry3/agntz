import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type { Migration } from "./index.js";

export type SqliteDatabase = DatabaseType;

export interface CreateSqliteDatabaseOptions {
	/** File path, or `":memory:"` for an in-memory database. */
	path: string;
	/** Log every statement to the console (better-sqlite3 `verbose`). */
	verbose?: boolean;
	/**
	 * Use WAL journaling (default). Set `false` to fall back to the rollback
	 * journal (`DELETE`) — required for some read-only / networked filesystems.
	 */
	wal?: boolean;
}

/**
 * Open a better-sqlite3 database with agntz's standard pragmas: WAL journaling,
 * `synchronous = NORMAL`, foreign keys enforced, and a 5s busy timeout. Passing
 * `wal: false` switches the journal mode to `DELETE` after opening.
 */
export function createSqliteDatabase(
	options: CreateSqliteDatabaseOptions,
): SqliteDatabase {
	const db = new Database(options.path, {
		verbose: options.verbose ? console.log : undefined,
	});
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("foreign_keys = ON");
	db.pragma("busy_timeout = 5000");
	if (options.wal === false) {
		db.pragma("journal_mode = DELETE");
	}
	return db;
}

/**
 * Read the current schema version from `versionTable`. Returns 0 when the table
 * does not exist yet (a fresh database) or the read otherwise fails — the same
 * "treat as unmigrated" behavior every agntz sqlite store has relied on.
 */
export function getSqliteSchemaVersion(
	db: SqliteDatabase,
	versionTable = "schema_version",
): number {
	try {
		const row = db
			.prepare(
				`SELECT version FROM ${versionTable} ORDER BY version DESC LIMIT 1`,
			)
			.get() as { version: number } | undefined;
		return row?.version ?? 0;
	} catch {
		return 0;
	}
}

export interface RunSqliteMigrationsOptions {
	/** Schema-version table to gate on (default `"schema_version"`). */
	versionTable?: string;
}

/**
 * Run every migration newer than the database's current schema version.
 *
 * `migrations[i]` is the step that advances the schema to version `i + 1`; each
 * migration is responsible for recording its own version (e.g. updating
 * `versionTable`). SQLite migrations run synchronously, in order, on open.
 */
export function runSqliteMigrations(
	db: SqliteDatabase,
	migrations: readonly Migration[],
	options: RunSqliteMigrationsOptions = {},
): void {
	const versionTable = options.versionTable ?? "schema_version";
	const currentVersion = getSqliteSchemaVersion(db, versionTable);
	for (let i = currentVersion; i < migrations.length; i++) {
		db.exec(migrations[i]);
	}
}
