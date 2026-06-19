# @agntz/core

## 1.7.0

### Minor Changes

- cfae485: Deduplicate the manifest→runner execution bridge shared by the embedded SDK and the hosted worker.

  - **@agntz/core** gains `createManifestExecutionContext(runner, opts)` (+ `ManifestExecutionContextOptions`, `ManifestBridgeHooks`) — the single shared implementation of the manifest `ExecutionContext` (`invokeLLM`/`invokeTool`, output parsing, temp-agent lifecycle). Both hosts previously re-implemented this; they now supply only their environment-specific seams (`resolveAgent` source, temp-agent cleanup, `spawnable` pre-registration, local-tool dispatch, observability hooks) and delegate the shared mechanics here. The exported `createExecutionContext` signatures in `@agntz/sdk` and `@agntz/worker` are unchanged, so call sites are untouched.
  - **@agntz/worker** — parity/bug fix: `http` **pipeline tool steps** now forward `body`/`body_type`/`auth` and the runner's `tokenResolver`/`tokenCache`, which the worker previously dropped (authed or bodied http pipeline steps worked in the embedded SDK but silently misfired hosted). The `[llm]`/`[tool]` console breadcrumbs are preserved via the new hooks. Minor edge-case alignment: an explicit empty `state.userQuery` is now used verbatim as the user message (matching the SDK) instead of being replaced by the serialized state.
  - **@agntz/sdk** — drops its hand-rolled namespace-grant validators in favor of `@agntz/contracts`' canonical `normalizeNamespaceGrants`/`narrowNamespaceGrants` (re-exported by `@agntz/core`). Validation rules are identical; malformed grants now throw a typed `NamespaceGrantError` instead of a plain `Error`.

  Internal consolidation; no public API changes beyond the new `@agntz/core` exports.

- e97fd52: Merge `@agntz/manifest` into `@agntz/core` and remove the standalone package.

  The YAML manifest engine (parser, validator, template engine, state, and the graph executor) now ships as part of `@agntz/core`, exposed at the **`@agntz/core/manifest`** subpath. Import its API from there instead of `@agntz/manifest` — the standalone package is removed. The DSL itself is unchanged; this is a packaging consolidation (manifest and the runtime are always used together). `@agntz/sdk` and `@agntz/worker` are repointed to the subpath.

### Patch Changes

- 5f2a42e: Introduce `@agntz/contracts`, the shared-vocabulary kernel, and route `@agntz/core` through it.

  - **@agntz/contracts** (new): a zero-runtime-dependency package for the vocabulary and pure leaf utilities both core and manifest need — the outbound-URL policy (SSRF guard + hardened fetch), the agent-ref parser (`parseAgentRef`/`formatAgentRef`/`ParsedAgentRef`), the base error types (`AgntzError`, `InvalidAgentRefError`), the declarative HTTP-tool / auth / skill config (`HTTPToolEntry`, `AgentState`, `ToolReference`, `SkillDefinition`, `HTTPAuth` and its variants), and a structural `ExecutionSpanEmitter` interface.
  - **@agntz/core**: the moved vocabulary/utilities now live in `@agntz/contracts`; core imports the canonical shapes from there and re-exports them from their original module paths, so core's public surface and `instanceof` behavior are unchanged. This deletes the hand-copied structural mirrors of manifest's `HTTPToolEntry`/`AgentState`/`HTTPAuth` types (the bidirectional duplication is gone). The `TokenExchangeAuth.apply` mirror drift is resolved to optional, matching the token resolver, which already defaults a missing `apply`.
  - The manifest DSL (which ships in `@agntz/core`) consumes the kernel's vocabulary directly — no local copies — and types its `ExecutionContext.spanEmitter` against the structural `ExecutionSpanEmitter` (which core's concrete `SpanEmitter` satisfies).

- 6d35efe: Make the store and resource adapters depend only on `@agntz/contracts` (ports-and-adapters).

  - **@agntz/contracts** now owns the full data/contract layer: the storage **ports** (`UnifiedStore` + all sub-store interfaces, `ResourceProvider`/`ResourceToolContext`/`ResourceProviderToolDefinition`), the **entity types** (`AgentDefinition`, `Run`/`Session`/`Message`/`Trace`/`Span`, `Secret*`, `ApiKeyRecord`, `Connection*`, `ProviderConfig`, the full `Eval*` family, `InvokeResult`/`ContentBlock`/`TokenUsage`, …), the **model-call shapes** (`ModelProvider`, `GenerateTextOptions`/`Result`, `ModelStreamResult`), and the pure leaf utils (secret crypto, namespace grants, `defineSkill`, `listEvalRunsInProcess`). It gains a type-only `zod` dependency for `ResourceProviderToolDefinition.input`. The runtime execution types (`ToolDefinition`/`ToolContext`/`InvokeOptions`, `RunRegistry`, streaming, telemetry sinks) stay in `@agntz/core`.
  - **@agntz/core** imports those shapes from `@agntz/contracts` and re-exports them from their original module paths — its public surface and `instanceof` behavior are unchanged.
  - **@agntz/store-postgres / @agntz/store-sqlite** now depend on `@agntz/contracts` instead of `@agntz/core` — they implement the store ports without pulling in the runtime (no more transitive AI-SDK provider deps).
  - **@agntz/memrez** depends on `@agntz/contracts` (not `@agntz/core`). Its reasoner no longer constructs core's `AISDKModelProvider`; instead it accepts an injected `ModelProvider` via the new `modelProvider` option on `createMemrez`/the reasoner. **Behavior change:** LLM-backed curation/tagging now requires a host to inject a `ModelProvider` (e.g. `new AISDKModelProvider()`); the worker does this automatically. Store/read/scan paths are unaffected.

- Updated dependencies [5f2a42e]
- Updated dependencies [6d35efe]
  - @agntz/contracts@0.1.0

## 1.6.0

### Minor Changes

- 0749711: Memory + session deletion and per-tenant namespace roots.

  - **memrez**: hard-delete primitives `deleteEntry` / `deleteScope` (plus the underlying `MemoryStore` methods across in-memory, SQLite, and Postgres) and a `ResourceProvider.purgeScope` cascade hook; `curate` now only supersedes entries it actually scanned.
  - **core / stores**: `deleteSession` now erases everything linked to a session — messages, invocation logs, runs, spans, and traces — instead of leaving them behind; new `NamespaceRootStore` (per-tenant namespace roots) on `UnifiedStore`, implemented by the Postgres (migration v14) and SQLite stores.
  - **sdk**: `client.sessions` (list/get/delete) and `client.memory` (scan/read/list/deleteEntry/deleteScope/curate/correct) via a new `memrez` option.
  - **client**: `sessions.list/get/delete` and full `memory.*` parity with the SDK.

## 1.5.0

### Minor Changes

- 4692c35: Add CLI publish support for migrating local agents, sessions, and memory into hosted agntz. Includes authenticated worker import endpoints, client import methods, session snapshot import support, and memory entry enumeration/import support.

## 1.4.0

### Minor Changes

- a357dd1: Add versioned eval and dataset definitions with aliases, input-only dataset cases, rubric-based criteria, derived pass/fail outcomes, and version-aware latest-score storage.

  Dataset items are intentionally minimal: an id, optional name, agent input, and optional metadata. Eval judges now return scores and reasons only; criterion gates and top-level pass policies derive outcomes from configured thresholds. Eval runs snapshot resolved eval, dataset, and agent versions, support criterion-only diagnostic runs, and preserve immutable version history in memory, SQLite, and Postgres stores.

## 1.3.0

### Minor Changes

- 2879d18: Complete the first-class eval system with agent-scoped datasets, async hosted eval runs, cancellation, and latest-score persistence for version comparisons.

  Datasets now carry an `agentId`, evals validate that their default dataset belongs to the same agent, and failed cases with zero scores are included in aggregate scoring. Hosted eval runs now return immediately in a running state, persist progress case-by-case, support cancellation, and update a latest-score cache keyed by eval, dataset, and resolved agent version while preserving immutable run history.

## 1.2.3

### Patch Changes

- 665142b: Fix runtime provider smoke coverage and provider-specific tool loop handling. The runner now preserves detailed usage metadata across tool steps, recovers Cohere tool-result responses rejected by the upstream AI SDK citation schema, keeps OpenAI reasoning/tool-call response messages intact across streamed and non-streamed tool turns, and verifies shared sessions remain portable when switching between providers.

## 1.2.2

### Patch Changes

- [#72](https://github.com/aparry3/agntz/pull/72) [`8b11015`](https://github.com/aparry3/agntz/commit/8b1101595af7c7b1277707a6a377c4c62a7559e6) Thanks [@aparry3](https://github.com/aparry3)! - Preserve provider-normalized assistant response messages across tool-loop turns so reasoning items, thought signatures, and other provider-specific tool-call metadata are replayed correctly after tool execution.

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

  - `@agntz/core`: TypeScript SDK for defining and running AI agents with first-class MCP support and pluggable storage.
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
