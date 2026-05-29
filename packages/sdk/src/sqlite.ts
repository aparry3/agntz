import type { UnifiedStore } from "@agntz/core";
import { SqliteStore } from "@agntz/store-sqlite";

export interface SqliteStoreOptions {
	/** Filesystem path to the SQLite database. The file is created if missing. */
	path: string;
	/** Enable WAL mode for concurrent reads during writes. Defaults to off. */
	wal?: boolean;
	/** Log every SQL statement to console. Off by default. */
	verbose?: boolean;
	/**
	 * Optional user-id to scope this store to a single tenant. Embedded use
	 * cases typically leave this unset (single-user); pass it only if you're
	 * sharing one db between distinct tenants in-process.
	 */
	userId?: string;
}

/**
 * Construct a SQLite-backed `UnifiedStore` for use with `agntz()`. Persists
 * sessions and invocation logs across process restarts.
 *
 * Requires `@agntz/store-sqlite` (and its `better-sqlite3` peer dep) to be
 * installed alongside `@agntz/sdk`. Kept as a separate subpath export
 * so users who don't need persistence don't pull in native bindings.
 *
 * ```ts
 * import { agntz } from "@agntz/sdk";
 * import { sqliteStore } from "@agntz/sdk/sqlite";
 *
 * const client = await agntz({
 *   agents: "./agents",
 *   store: sqliteStore("./agntz.db"),
 * });
 * ```
 */
export function sqliteStore(
	options: SqliteStoreOptions | string,
): UnifiedStore {
	const opts: SqliteStoreOptions =
		typeof options === "string" ? { path: options } : options;
	// The SqliteStore enforces multi-tenant scoping; in embedded mode we
	// implicitly run as a single user. Default to "embedded" so callers
	// don't need to know about the tenancy model — pass `userId` to override.
	const admin = new SqliteStore({
		path: opts.path,
		wal: opts.wal,
		verbose: opts.verbose,
	});
	return admin.forUser(opts.userId ?? "embedded") as unknown as UnifiedStore;
}
