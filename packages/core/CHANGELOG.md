# @agntz/core

## 1.0.0

### Major Changes

- [#5](https://github.com/aparry3/agntz/pull/5) [`5a6a2e5`](https://github.com/aparry3/agntz/commit/5a6a2e533246621319462f204f3e023f1458d678) Thanks [@aparry3](https://github.com/aparry3)! - First public release under the `@agntz/*` scope (renamed from `agent-runner`).

  - `@agntz/core`: TypeScript SDK for defining, running, and evaluating AI agents with first-class MCP support and pluggable storage.
  - `@agntz/manifest`: YAML manifest engine — parser, template engine, state management, and pipeline execution.
  - `@agntz/sdk`: universal HTTP client for the agntz API (Node + browser, SSE streaming).
  - `@agntz/store-postgres`: PostgreSQL store adapter for multi-server deployments.
  - `@agntz/store-sqlite`: SQLite store adapter for single-server deployments.

  Also normalized `@agntz/manifest`'s peer dependency on `@agntz/core` from `workspace:*` to `>=0.1.2`, matching the other store packages and avoiding an over-pinned version at publish time.

## 0.1.2

### Patch Changes

- [`fa58631`](https://github.com/aparry3/agent-runner/commit/fa58631b66e3c0020b19d2369968939945d96529) Thanks [@aparry3](https://github.com/aparry3)! - Remove stdio MCP transport to fix bundling issues in Next.js and web environments. Only HTTP (Streamable HTTP / SSE) transport is now supported. MCPServerConfig no longer accepts `command`/`args`/`env` — use `url` instead.

## 0.1.1

### Patch Changes

- [`4c55ae5`](https://github.com/aparry3/agent-runner/commit/4c55ae523f2cc9f3c369017ea7a68a82610741bb) Thanks [@aparry3](https://github.com/aparry3)! - Initial npm release with comprehensive documentation
