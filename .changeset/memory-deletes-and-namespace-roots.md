---
"@agntz/core": minor
"@agntz/memrez": minor
"@agntz/store-postgres": minor
"@agntz/store-sqlite": minor
"@agntz/client": minor
"@agntz/sdk": minor
---

Memory + session deletion and per-tenant namespace roots.

- **memrez**: hard-delete primitives `deleteEntry` / `deleteScope` (plus the underlying `MemoryStore` methods across in-memory, SQLite, and Postgres) and a `ResourceProvider.purgeScope` cascade hook; `curate` now only supersedes entries it actually scanned.
- **core / stores**: `deleteSession` now erases everything linked to a session — messages, invocation logs, runs, spans, and traces — instead of leaving them behind; new `NamespaceRootStore` (per-tenant namespace roots) on `UnifiedStore`, implemented by the Postgres (migration v14) and SQLite stores.
- **sdk**: `client.sessions` (list/get/delete) and `client.memory` (scan/read/list/deleteEntry/deleteScope/curate/correct) via a new `memrez` option.
- **client**: `sessions.list/get/delete` and full `memory.*` parity with the SDK.
