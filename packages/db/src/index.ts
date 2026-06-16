/**
 * `@agntz/db` — shared database plumbing for agntz stores.
 *
 * The driver-specific helpers live in subpath entries so a single-backend
 * consumer never pulls in the driver it doesn't use:
 *
 *   import { createPostgresPool, PostgresMigrator } from "@agntz/db/postgres";
 *   import { createSqliteDatabase, runSqliteMigrations } from "@agntz/db/sqlite";
 *
 * This root entry holds only driver-agnostic, dependency-free types.
 */

/**
 * One ordered migration step expressed as raw SQL. A migration list's index
 * `i` is the schema version `i + 1` it brings the database to; the runner only
 * executes steps from the current on-disk version forward.
 */
export type Migration = string;
