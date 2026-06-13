# @agntz/store-sqlite

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
