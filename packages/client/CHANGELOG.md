# @agntz/client

## 1.3.1

### Patch Changes

- c27f2d9: Refresh the published documentation and make the hosted platform boundary release explicit.

  - **@agntz/client**: republish the README/API documentation for the current hosted surface: agents, sessions, runs, streams, memory, traces, datasets, evals, eval runs, and latest scores.
  - **@agntz/platform**: first public release of the hosted platform boundary package for API-key, namespace-root, webhook-delivery, and platform store contracts.

## 1.3.0

### Minor Changes

- 0749711: Memory + session deletion and per-tenant namespace roots.

  - **memrez**: hard-delete primitives `deleteEntry` / `deleteScope` (plus the underlying `MemoryStore` methods across in-memory, SQLite, and Postgres) and a `ResourceProvider.purgeScope` cascade hook; `curate` now only supersedes entries it actually scanned.
  - **core / stores**: `deleteSession` now erases everything linked to a session — messages, invocation logs, runs, spans, and traces — instead of leaving them behind; new `NamespaceRootStore` (per-tenant namespace roots) on `UnifiedStore`, implemented by the Postgres (migration v14) and SQLite stores.
  - **sdk**: `client.sessions` (list/get/delete) and `client.memory` (scan/read/list/deleteEntry/deleteScope/curate/correct) via a new `memrez` option.
  - **client**: `sessions.list/get/delete` and full `memory.*` parity with the SDK.

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
