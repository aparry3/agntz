---
"@agntz/core": major
"@agntz/manifest": major
"@agntz/sdk": major
"@agntz/store-postgres": major
"@agntz/store-sqlite": major
---

First public release under the `@agntz/*` scope (renamed from `agent-runner`).

- `@agntz/core`: TypeScript SDK for defining, running, and evaluating AI agents with first-class MCP support and pluggable storage.
- `@agntz/manifest`: YAML manifest engine — parser, template engine, state management, and pipeline execution.
- `@agntz/sdk`: universal HTTP client for the agntz API (Node + browser, SSE streaming).
- `@agntz/store-postgres`: PostgreSQL store adapter for multi-server deployments.
- `@agntz/store-sqlite`: SQLite store adapter for single-server deployments.

Also normalized `@agntz/manifest`'s peer dependency on `@agntz/core` from `workspace:*` to `>=0.1.2`, matching the other store packages and avoiding an over-pinned version at publish time.
