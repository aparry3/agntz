# @agntz/store-postgres

## 7.1.0

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
- Updated dependencies [c27f2d9]
- Updated dependencies [6d35efe]
  - @agntz/contracts@0.1.0
  - @agntz/db@0.1.0
  - @agntz/platform@1.0.0

## 7.0.0

### Minor Changes

- 0749711: Memory + session deletion and per-tenant namespace roots.

  - **memrez**: hard-delete primitives `deleteEntry` / `deleteScope` (plus the underlying `MemoryStore` methods across in-memory, SQLite, and Postgres) and a `ResourceProvider.purgeScope` cascade hook; `curate` now only supersedes entries it actually scanned.
  - **core / stores**: `deleteSession` now erases everything linked to a session — messages, invocation logs, runs, spans, and traces — instead of leaving them behind; new `NamespaceRootStore` (per-tenant namespace roots) on `UnifiedStore`, implemented by the Postgres (migration v14) and SQLite stores.
  - **sdk**: `client.sessions` (list/get/delete) and `client.memory` (scan/read/list/deleteEntry/deleteScope/curate/correct) via a new `memrez` option.
  - **client**: `sessions.list/get/delete` and full `memory.*` parity with the SDK.

### Patch Changes

- Updated dependencies [0749711]
  - @agntz/core@1.6.0

## 6.0.0

### Minor Changes

- 4692c35: Add CLI publish support for migrating local agents, sessions, and memory into hosted agntz. Includes authenticated worker import endpoints, client import methods, session snapshot import support, and memory entry enumeration/import support.

### Patch Changes

- Updated dependencies [4692c35]
  - @agntz/core@1.5.0

## 5.0.0

### Minor Changes

- a357dd1: Add versioned eval and dataset definitions with aliases, input-only dataset cases, rubric-based criteria, derived pass/fail outcomes, and version-aware latest-score storage.

  Dataset items are intentionally minimal: an id, optional name, agent input, and optional metadata. Eval judges now return scores and reasons only; criterion gates and top-level pass policies derive outcomes from configured thresholds. Eval runs snapshot resolved eval, dataset, and agent versions, support criterion-only diagnostic runs, and preserve immutable version history in memory, SQLite, and Postgres stores.

### Patch Changes

- Updated dependencies [a357dd1]
  - @agntz/core@1.4.0

## 4.0.0

### Minor Changes

- 2879d18: Complete the first-class eval system with agent-scoped datasets, async hosted eval runs, cancellation, and latest-score persistence for version comparisons.

  Datasets now carry an `agentId`, evals validate that their default dataset belongs to the same agent, and failed cases with zero scores are included in aggregate scoring. Hosted eval runs now return immediately in a running state, persist progress case-by-case, support cancellation, and update a latest-score cache keyed by eval, dataset, and resolved agent version while preserving immutable run history.

### Patch Changes

- Updated dependencies [2879d18]
  - @agntz/core@1.3.0

## 3.0.0

### Patch Changes

- Updated dependencies [[`2d098f4`](https://github.com/aparry3/agntz/commit/2d098f4713151a120b12f85d4abd630835840b56)]:
  - @agntz/core@1.2.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`44a8bd0`](https://github.com/aparry3/agntz/commit/44a8bd0feebfffb6cdf4e22a6aa4b326244bf166)]:
  - @agntz/core@1.1.0

## 1.0.0

### Major Changes

- [#5](https://github.com/aparry3/agntz/pull/5) [`5a6a2e5`](https://github.com/aparry3/agntz/commit/5a6a2e533246621319462f204f3e023f1458d678) Thanks [@aparry3](https://github.com/aparry3)! - First public release under the `@agntz/*` scope (renamed from `agent-runner`).

  - `@agntz/core`: TypeScript SDK for defining and running AI agents with first-class MCP support and pluggable storage.
  - `@agntz/manifest`: YAML manifest engine — parser, template engine, state management, and pipeline execution.
  - `@agntz/sdk`: universal HTTP client for the agntz API (Node + browser, SSE streaming).
  - `@agntz/store-postgres`: PostgreSQL store adapter for multi-server deployments.
  - `@agntz/store-sqlite`: SQLite store adapter for single-server deployments.

  Also normalized `@agntz/manifest`'s peer dependency on `@agntz/core` from `workspace:*` to `>=0.1.2`, matching the other store packages and avoiding an over-pinned version at publish time.

### Patch Changes

- Updated dependencies [[`5a6a2e5`](https://github.com/aparry3/agntz/commit/5a6a2e533246621319462f204f3e023f1458d678)]:
  - @agntz/core@1.0.0

## 0.1.1

### Patch Changes

- [`4c55ae5`](https://github.com/aparry3/agent-runner/commit/4c55ae523f2cc9f3c369017ea7a68a82610741bb) Thanks [@aparry3](https://github.com/aparry3)! - Initial npm release with comprehensive documentation

- Updated dependencies [[`4c55ae5`](https://github.com/aparry3/agent-runner/commit/4c55ae523f2cc9f3c369017ea7a68a82610741bb)]:
  - @agntz/core@0.1.1
