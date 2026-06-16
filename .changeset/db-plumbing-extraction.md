---
"@agntz/db": minor
"@agntz/store-postgres": patch
"@agntz/store-sqlite": patch
"@agntz/memrez": patch
---

Extract shared database plumbing into a new `@agntz/db` package.

- **@agntz/db** (new): pooling, migrations, and connection hardening for Postgres and SQLite, exposed via `@agntz/db/postgres` and `@agntz/db/sqlite`. The drivers (`pg`, `better-sqlite3`) are optional peer dependencies, so a single-backend consumer never installs the one it doesn't use. The production connection hardening is now baked in once — `keepAlive`, connection/idle timeouts, an idle-client error handler, and a migration runner that **clears a failed migration instead of caching the rejection forever** (the fix for the "connection terminated unexpectedly" wedge).
- **store-postgres / store-sqlite / memrez**: migrated onto `@agntz/db` for pool creation and migrations. Table ownership is unchanged (`ar_*` vs `memrez_*`) and behavior is preserved. memrez's Postgres store additionally gains the advisory-locked, reset-on-failure migration path, fixing its latent poisoned-promise bug.
