# @agntz/client

## 1.2.0

### Minor Changes

- 4692c35: Add CLI publish support for migrating local agents, sessions, and memory into hosted agntz. Includes authenticated worker import endpoints, client import methods, session snapshot import support, and memory entry enumeration/import support.

## 1.1.0

### Minor Changes

- 2879d18: Complete the first-class eval system with agent-scoped datasets, async hosted eval runs, cancellation, and latest-score persistence for version comparisons.

  Datasets now carry an `agentId`, evals validate that their default dataset belongs to the same agent, and failed cases with zero scores are included in aggregate scoring. Hosted eval runs now return immediately in a running state, persist progress case-by-case, support cancellation, and update a latest-score cache keyed by eval, dataset, and resolved agent version while preserving immutable run history.

## 1.0.1

### Patch Changes

- Pass runtime namespace context grants through hosted client run and stream calls.

> Renamed from `@agntz/sdk` (the prior `@agntz/sdk` v1.x is the same code, now deprecated on npm).

## 1.0.0

### Major Changes

- [#5](https://github.com/aparry3/agntz/pull/5) [`5a6a2e5`](https://github.com/aparry3/agntz/commit/5a6a2e533246621319462f204f3e023f1458d678) Thanks [@aparry3](https://github.com/aparry3)! - First public release under the `@agntz/*` scope (renamed from `agent-runner`).

  - `@agntz/core`: TypeScript SDK for defining and running AI agents with first-class MCP support and pluggable storage.
  - `@agntz/manifest`: YAML manifest engine — parser, template engine, state management, and pipeline execution.
  - `@agntz/sdk`: universal HTTP client for the agntz API (Node + browser, SSE streaming).
  - `@agntz/store-postgres`: PostgreSQL store adapter for multi-server deployments.
  - `@agntz/store-sqlite`: SQLite store adapter for single-server deployments.

  Also normalized `@agntz/manifest`'s peer dependency on `@agntz/core` from `workspace:*` to `>=0.1.2`, matching the other store packages and avoiding an over-pinned version at publish time.
