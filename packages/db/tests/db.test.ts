import { describe, expect, it } from "vitest";
import { PostgresMigrator, type PostgresPool } from "../src/postgres.js";
import {
	createSqliteDatabase,
	getSqliteSchemaVersion,
	runSqliteMigrations,
} from "../src/sqlite.js";

describe("createSqliteDatabase", () => {
	it("applies the standard pragmas", () => {
		const db = createSqliteDatabase({ path: ":memory:" });
		expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
		expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
		db.close();
	});
});

describe("runSqliteMigrations", () => {
	it("runs only migrations newer than the on-disk version", () => {
		const db = createSqliteDatabase({ path: ":memory:" });
		const migrations = [
			`CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
			 INSERT INTO schema_version (version) VALUES (1);
			 CREATE TABLE t (id TEXT);`,
			`ALTER TABLE t ADD COLUMN name TEXT;
			 INSERT INTO schema_version (version) VALUES (2);`,
		];

		runSqliteMigrations(db, migrations);
		expect(getSqliteSchemaVersion(db)).toBe(2);

		// Re-running is a no-op — every step is already applied, so nothing throws
		// (a second `CREATE TABLE t` would).
		runSqliteMigrations(db, migrations);
		expect(getSqliteSchemaVersion(db)).toBe(2);
		db.close();
	});

	it("reports version 0 for a fresh database", () => {
		const db = createSqliteDatabase({ path: ":memory:" });
		expect(getSqliteSchemaVersion(db)).toBe(0);
		db.close();
	});
});

describe("PostgresMigrator", () => {
	// A pool whose first connect() fails (simulating the outage) and whose later
	// connects succeed. The success client answers every query benignly so the
	// migrator's lock/version/migration/unlock sequence completes.
	function flakyPool(failFirst: boolean): {
		pool: PostgresPool;
		attempts: () => number;
	} {
		let attempts = 0;
		const okClient = {
			query: async () => ({ rows: [] as Array<{ version: number }> }),
			release: () => {},
		};
		const pool = {
			connect: async () => {
				attempts += 1;
				if (failFirst && attempts === 1) {
					throw new Error("connection terminated unexpectedly");
				}
				return okClient;
			},
		} as unknown as PostgresPool;
		return { pool, attempts: () => attempts };
	}

	it("clears a failed migration so the next call retries (no poisoned promise)", async () => {
		const { pool, attempts } = flakyPool(true);
		const migrator = new PostgresMigrator({
			pool,
			migrations: ["SELECT 1;"],
			versionTable: "ar_schema_version",
			lockName: "ar_",
		});

		// First attempt surfaces the connection error and leaves the store unmigrated.
		await expect(migrator.ensureMigrated()).rejects.toThrow(
			"connection terminated",
		);
		expect(migrator.isMigrated).toBe(false);

		// The fix: a later call retries from scratch instead of replaying the
		// cached rejection forever.
		await migrator.ensureMigrated();
		expect(migrator.isMigrated).toBe(true);
		expect(attempts()).toBe(2);
	});

	it("markMigrated skips running migrations entirely", async () => {
		const { pool, attempts } = flakyPool(false);
		const migrator = new PostgresMigrator({
			pool,
			migrations: ["SELECT 1;"],
			versionTable: "ar_schema_version",
			lockName: "ar_",
		});
		migrator.markMigrated();
		await migrator.ensureMigrated();
		expect(migrator.isMigrated).toBe(true);
		expect(attempts()).toBe(0);
	});
});
