---
"@agntz/core": major
"@agntz/stores": minor
"@agntz/sdk": minor
"@agntz/contracts": patch
---

Consolidate storage and hosted-contract packaging around `@agntz/stores`.

- **@agntz/stores** becomes the single storage package, with `contracts`, `memory`, `postgres`, and `sqlite` subpaths. It replaces the retired `@agntz/platform`, `@agntz/store-postgres`, and `@agntz/store-sqlite` packages.
- **@agntz/core** no longer exports or owns a concrete `MemoryStore`. `createRunner` now requires an injected `store` or a complete set of split stores; concrete storage comes from `@agntz/stores`.
- **@agntz/sdk** depends on `@agntz/stores` for its embedded default memory store and continues to expose the optional SQLite helper through `agntz/sqlite`.
- **@agntz/contracts** keeps the shared secret-crypto and store vocabulary used by the consolidated store implementations.

The repository also removes the experimental Python hosted server surface (`agntz.server` and `agntz.platform`) so hosted deployments are maintained through the TypeScript worker only.
