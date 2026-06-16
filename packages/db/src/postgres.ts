import { createHash } from "node:crypto";
import pg from "pg";
import type { Migration } from "./index.js";

const { Pool } = pg;

type PoolType = InstanceType<typeof pg.Pool>;
type PoolConfigType = pg.PoolConfig;
type PoolClientType = pg.PoolClient;

export type PostgresPool = PoolType;
export type PostgresPoolClient = PoolClientType;
export type PostgresPoolConfig = PoolConfigType;

/**
 * Connection-resilience defaults applied to every pool agntz creates. These
 * harden against the failure mode behind the production outage — idle clients
 * silently dying after a database/proxy restart — without changing query
 * semantics. Callers can override any field via `options.config`.
 *
 * Note: SSL is intentionally NOT forced here. Whether TLS is required is a
 * deployment concern, so it is left to the connection string (`?sslmode=...`)
 * or an explicit `config.ssl`, preserving local/test behavior.
 */
const POOL_HARDENING_DEFAULTS: PoolConfigType = {
	keepAlive: true,
	connectionTimeoutMillis: 10_000,
	idleTimeoutMillis: 30_000,
	max: 10,
};

export interface CreatePostgresPoolOptions {
	/** Extra `PoolConfig` merged over the hardening defaults (e.g. `ssl`, `max`). */
	config?: PoolConfigType;
	/**
	 * Handler for errors emitted by idle clients in the pool. Only attached when
	 * this call owns the pool. Defaults to a `console.warn` so a post-restart
	 * idle-client error never surfaces as an unhandled `EventEmitter` error.
	 */
	onIdleClientError?: (err: Error) => void;
}

export interface PostgresPoolHandle {
	pool: PostgresPool;
	/** `true` when this call created the pool (and so owns ending it). */
	ownsPool: boolean;
}

/**
 * Resolve a connection spec into a pool. Accepts a connection string, a
 * `PoolConfig`, or an already-constructed `Pool` (which is reused as-is and
 * reported as not-owned, so the caller doesn't end a pool it borrowed).
 *
 * When a pool is created here it gets {@link POOL_HARDENING_DEFAULTS} plus an
 * idle-client error handler.
 */
export function createPostgresPool(
	connection: string | PoolConfigType | PostgresPool,
	options: CreatePostgresPoolOptions = {},
): PostgresPoolHandle {
	let pool: PostgresPool;
	let ownsPool: boolean;

	if (typeof connection === "string") {
		pool = new Pool({
			...POOL_HARDENING_DEFAULTS,
			connectionString: connection,
			...options.config,
		});
		ownsPool = true;
	} else if (isPool(connection)) {
		pool = connection;
		ownsPool = false;
	} else {
		pool = new Pool({
			...POOL_HARDENING_DEFAULTS,
			...connection,
			...options.config,
		});
		ownsPool = true;
	}

	if (ownsPool) {
		const onError =
			options.onIdleClientError ??
			((err: Error) => {
				console.warn("@agntz/db postgres idle client error:", err.message);
			});
		pool.on("error", onError);
	}

	return { pool, ownsPool };
}

function isPool(value: PoolConfigType | PostgresPool): value is PostgresPool {
	return (
		typeof (value as PostgresPool).query === "function" &&
		typeof (value as PostgresPool).connect === "function"
	);
}

export interface PostgresMigratorOptions {
	pool: PostgresPool;
	/**
	 * Ordered migration SQL. `migrations[i]` advances the schema to version
	 * `i + 1` and is responsible for recording that version in `versionTable`.
	 */
	migrations: readonly Migration[];
	/**
	 * Fully-qualified schema-version table name (already prefixed/quoted as the
	 * store needs it), e.g. `"ar_schema_version"`.
	 */
	versionTable: string;
	/**
	 * Stable identifier used to derive the cross-process advisory-lock key.
	 * Distinct names let independent migration sets (e.g. core vs. memrez) run
	 * concurrently instead of serializing against each other.
	 */
	lockName: string;
	/**
	 * Optional transform applied to each migration's SQL before execution — used
	 * by stores that template a table prefix into otherwise-static SQL.
	 */
	transform?: (sql: string) => string;
}

/**
 * Runs versioned Postgres migrations exactly once per database, serialized
 * across every process that shares it via a session-scoped advisory lock.
 *
 * State (in-flight promise + completion flag) lives on the instance, so a store
 * that fans out per-user views can share a single migrator and have those views
 * await the same migration rather than racing their own.
 *
 * Crucially, a failed migration promise is cleared (not cached forever): a
 * transient outage no longer poisons the store, so a later call retries instead
 * of replaying the original rejection. This is the fix for the production
 * "connection terminated unexpectedly" wedge.
 */
export class PostgresMigrator {
	private readonly pool: PostgresPool;
	private readonly migrations: readonly Migration[];
	private readonly versionTable: string;
	private readonly lockKey: string;
	private readonly transform: (sql: string) => string;
	private migrated = false;
	private migratePromise: Promise<void> | null = null;

	constructor(options: PostgresMigratorOptions) {
		this.pool = options.pool;
		this.migrations = options.migrations;
		this.versionTable = options.versionTable;
		this.lockKey = deriveLockKey(options.lockName);
		this.transform = options.transform ?? identity;
	}

	/**
	 * Kick off migration in the background (e.g. at store construction). The
	 * rejection is marked handled so a failure never crashes the process as an
	 * unhandled rejection; {@link ensureMigrated} surfaces it on first real use.
	 */
	start(): void {
		if (this.migrated || this.migratePromise) return;
		const promise = this.migrate().catch((err) => {
			// Clear on failure so the next ensureMigrated() retries rather than
			// replaying a stale rejection forever.
			if (this.migratePromise === promise) {
				this.migratePromise = null;
			}
			throw err;
		});
		this.migratePromise = promise;
		promise.catch(() => {});
	}

	/** Await migration completion, starting it if it hasn't begun. */
	async ensureMigrated(): Promise<void> {
		if (this.migrated) return;
		if (!this.migratePromise) {
			this.start();
		}
		await this.migratePromise;
	}

	/** Mark the schema as already migrated, skipping any run (e.g. `runMigrations: false`). */
	markMigrated(): void {
		this.migrated = true;
	}

	/** Whether migration has completed on this instance. */
	get isMigrated(): boolean {
		return this.migrated;
	}

	private async migrate(): Promise<void> {
		// Hold a single connection so the advisory lock and migration queries run
		// on the same session — pg_advisory_lock is session-scoped.
		const client = await this.pool.connect();
		try {
			// Serializes migrations across all processes sharing this database
			// (e.g. app + worker booting concurrently).
			await client.query("SELECT pg_advisory_lock($1)", [this.lockKey]);
			try {
				const currentVersion = await this.getSchemaVersion(client);
				// Heal stale rows from prior failed/racing migrations: the version
				// table is meant to hold exactly one row, but a double-INSERT from
				// older code could leave several, breaking single-row UPDATEs.
				if (currentVersion > 0) {
					await client.query(
						`DELETE FROM ${this.versionTable} WHERE version < $1`,
						[currentVersion],
					);
				}
				for (let i = currentVersion; i < this.migrations.length; i++) {
					await client.query(this.transform(this.migrations[i]));
				}
				this.migrated = true;
			} finally {
				await client.query("SELECT pg_advisory_unlock($1)", [this.lockKey]);
			}
		} finally {
			client.release();
		}
	}

	private async getSchemaVersion(
		executor: PostgresPool | PostgresPoolClient = this.pool,
	): Promise<number> {
		try {
			const result = await executor.query(
				`SELECT version FROM ${this.versionTable} ORDER BY version DESC LIMIT 1`,
			);
			return result.rows[0]?.version ?? 0;
		} catch {
			return 0;
		}
	}
}

function identity(sql: string): string {
	return sql;
}

/**
 * Derive a stable 64-bit advisory-lock key from a name. Mirrors the historical
 * derivation so existing deployments keep using the same lock.
 */
function deriveLockKey(name: string): string {
	const hash = createHash("sha256").update(`agntz-migration:${name}`).digest();
	return hash.readBigInt64BE(0).toString();
}
