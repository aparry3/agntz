# @agntz/memrez

## 4.1.0

### Minor Changes

- 6d35efe: Make the store and resource adapters depend only on `@agntz/contracts` (ports-and-adapters).

  - **@agntz/contracts** now owns the full data/contract layer: the storage **ports** (`UnifiedStore` + all sub-store interfaces, `ResourceProvider`/`ResourceToolContext`/`ResourceProviderToolDefinition`), the **entity types** (`AgentDefinition`, `Run`/`Session`/`Message`/`Trace`/`Span`, `Secret*`, `ApiKeyRecord`, `Connection*`, `ProviderConfig`, the full `Eval*` family, `InvokeResult`/`ContentBlock`/`TokenUsage`, …), the **model-call shapes** (`ModelProvider`, `GenerateTextOptions`/`Result`, `ModelStreamResult`), and the pure leaf utils (secret crypto, namespace grants, `defineSkill`, `listEvalRunsInProcess`). It gains a type-only `zod` dependency for `ResourceProviderToolDefinition.input`. The runtime execution types (`ToolDefinition`/`ToolContext`/`InvokeOptions`, `RunRegistry`, streaming, telemetry sinks) stay in `@agntz/core`.
  - **@agntz/core** imports those shapes from `@agntz/contracts` and re-exports them from their original module paths — its public surface and `instanceof` behavior are unchanged.
  - **@agntz/store-postgres / @agntz/store-sqlite** now depend on `@agntz/contracts` instead of `@agntz/core` — they implement the store ports without pulling in the runtime (no more transitive AI-SDK provider deps).
  - **@agntz/memrez** depends on `@agntz/contracts` (not `@agntz/core`). Its reasoner no longer constructs core's `AISDKModelProvider`; instead it accepts an injected `ModelProvider` via the new `modelProvider` option on `createMemrez`/the reasoner. **Behavior change:** LLM-backed curation/tagging now requires a host to inject a `ModelProvider` (e.g. `new AISDKModelProvider()`); the worker does this automatically. Store/read/scan paths are unaffected.

### Patch Changes

- 0ed0d94: Extract shared database plumbing into a new `@agntz/db` package.

  - **@agntz/db** (new): pooling, migrations, and connection hardening for Postgres and SQLite, exposed via `@agntz/db/postgres` and `@agntz/db/sqlite`. The drivers (`pg`, `better-sqlite3`) are optional peer dependencies, so a single-backend consumer never installs the one it doesn't use. The production connection hardening is now baked in once — `keepAlive`, connection/idle timeouts, an idle-client error handler, and a migration runner that **clears a failed migration instead of caching the rejection forever** (the fix for the "connection terminated unexpectedly" wedge).
  - **store-postgres / store-sqlite / memrez**: migrated onto `@agntz/db` for pool creation and migrations. Table ownership is unchanged (`ar_*` vs `memrez_*`) and behavior is preserved. memrez's Postgres store additionally gains the advisory-locked, reset-on-failure migration path, fixing its latent poisoned-promise bug.

- Updated dependencies [5f2a42e]
- Updated dependencies [0ed0d94]
- Updated dependencies [6d35efe]
  - @agntz/contracts@0.1.0
  - @agntz/db@0.1.0

## 4.0.0

### Minor Changes

- 0749711: Memory + session deletion and per-tenant namespace roots.

  - **memrez**: hard-delete primitives `deleteEntry` / `deleteScope` (plus the underlying `MemoryStore` methods across in-memory, SQLite, and Postgres) and a `ResourceProvider.purgeScope` cascade hook; `curate` now only supersedes entries it actually scanned.
  - **core / stores**: `deleteSession` now erases everything linked to a session — messages, invocation logs, runs, spans, and traces — instead of leaving them behind; new `NamespaceRootStore` (per-tenant namespace roots) on `UnifiedStore`, implemented by the Postgres (migration v14) and SQLite stores.
  - **sdk**: `client.sessions` (list/get/delete) and `client.memory` (scan/read/list/deleteEntry/deleteScope/curate/correct) via a new `memrez` option.
  - **client**: `sessions.list/get/delete` and full `memory.*` parity with the SDK.

### Patch Changes

- Updated dependencies [0749711]
  - @agntz/core@1.6.0

## 3.0.0

### Minor Changes

- 4692c35: Add CLI publish support for migrating local agents, sessions, and memory into hosted agntz. Includes authenticated worker import endpoints, client import methods, session snapshot import support, and memory entry enumeration/import support.

### Patch Changes

- Updated dependencies [4692c35]
  - @agntz/core@1.5.0

## 2.1.1

### Patch Changes

- c934126: Remove agent-level memory topic taxonomy config from the memrez resource provider. Agent manifests now own preload/read/write behavior only; topic taxonomy and reasoner policy are reserved for Memrez-level configuration.

## 2.1.0

### Minor Changes

- 2e92a9f: Add configurable memory preload topic policy with core and preferred topic support.

## 2.0.0

### Patch Changes

- Updated dependencies [a357dd1]
  - @agntz/core@1.4.0

## 1.0.0

### Patch Changes

- Updated dependencies [2879d18]
  - @agntz/core@1.3.0

## 0.1.0

### Minor Changes

- [#65](https://github.com/aparry3/agntz/pull/65) [`cdd1746`](https://github.com/aparry3/agntz/commit/cdd17461c573f3f582f090b19260a12fce43c954) Thanks [@aparry3](https://github.com/aparry3)! - Initial release of `@agntz/memrez` — a durable tagged memory layer for agntz agents. Provides SQLite- and Postgres-backed tagged memory with namespace grants, plus a `ResourceProvider` implementation that plugs into `@agntz/core`.
