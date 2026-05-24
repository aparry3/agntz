# @agntz/core

## 1.2.1

### Patch Changes

- [#43](https://github.com/aparry3/agntz/pull/43) [`c43b184`](https://github.com/aparry3/agntz/commit/c43b184ee004bd7298fa8a48ba1d465048c5b96b) Thanks [@aparry3](https://github.com/aparry3)! - Fix multi-turn tool calls with Gemini 3.x. Gemini attaches an opaque `thought_signature` to each function call and **requires it echoed back** on the next turn; the runner was discarding it, so any tool round-trip on a Gemini 3 model failed with `Function call is missing a thought_signature`.

  Tool calls now carry the provider's opaque metadata through `GenerateTextResult.toolCalls[].providerMetadata`, and the runner replays it as the tool-call part's `providerOptions` on the following turn. This is a no-op for providers that don't emit it (OpenAI, Anthropic, Mistral, Cohere, …) and for Gemini 2.5, which doesn't require the round-trip.

## 1.2.0

### Minor Changes

- [`2d098f4`](https://github.com/aparry3/agntz/commit/2d098f4713151a120b12f85d4abd630835840b56) Thanks [@aparry3](https://github.com/aparry3)! - Add OpenRouter as a first-class model provider. Use `{ provider: "openrouter", name: "<slug>" }` (e.g. `anthropic/claude-sonnet-4`, `meta-llama/llama-3.3-70b-instruct`) with `OPENROUTER_API_KEY` to access 300+ models — commercial and open-source — through a single key.

  Per-request cost reported by OpenRouter flows through to `TokenUsage.cost`, and `computeCost()` prefers provider-reported cost over the static rate table. Default attribution headers (`HTTP-Referer: https://agntz.co`, `X-Title: agntz`) can be overridden via the provider's stored `config`.

## 1.1.0

### Minor Changes

- [#38](https://github.com/aparry3/agntz/pull/38) [`44a8bd0`](https://github.com/aparry3/agntz/commit/44a8bd0feebfffb6cdf4e22a6aa4b326244bf166) Thanks [@aparry3](https://github.com/aparry3)! - Introduce `@agntz/runner` — embedded library for running agntz agents in-process from local YAML files.

  The five-line-of-code path:

  ```ts
  import { agntz } from "@agntz/runner";
  const client = await agntz({ agents: "./agents" });
  const result = await client.agents.run({ agentId: "support", input: "..." });
  ```

  SDK-shaped surface (`.agents.run/stream`, `.runs.list/get`, `.traces.list/get`) so user code graduates to `@agntz/sdk` with a single import-line change. Supports all four agent kinds (LLM, tool, sequential, parallel), local + HTTP + MCP tools, subagents, in-memory sessions, and `@agntz/runner/sqlite` for persistent storage. Real span hierarchy from `@agntz/manifest`'s executor feeds the in-memory `TracesBuffer`.

  **`@agntz/core`** and **`@agntz/manifest`** gain `{{env.NAME}}` template support for resolving env vars (typically `process.env`) in HTTP/MCP tool credentials, parallel to the existing `{{secrets.X}}` machinery. Embedded mode wires this on by default; hosted servers leave the new `RunnerConfig.envProvider` unset so user manifests can't read server env. The manifest validator emits warnings (never errors) on missing env refs.

  **`@agntz/core`** also adds `Runner.deregisterAgent()` for cleaning up in-memory temp agents — used by `@agntz/runner` for the per-LLM-step temp-agent dance during pipeline execution.

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
