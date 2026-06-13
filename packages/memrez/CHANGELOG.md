# @agntz/memrez

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
