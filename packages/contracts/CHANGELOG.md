# @agntz/contracts

## 0.1.0

### Minor Changes

- 5f2a42e: Introduce `@agntz/contracts`, the shared-vocabulary kernel, and route `@agntz/core` through it.

  - **@agntz/contracts** (new): a zero-runtime-dependency package for the vocabulary and pure leaf utilities both core and manifest need — the outbound-URL policy (SSRF guard + hardened fetch), the agent-ref parser (`parseAgentRef`/`formatAgentRef`/`ParsedAgentRef`), the base error types (`AgntzError`, `InvalidAgentRefError`), the declarative HTTP-tool / auth / skill config (`HTTPToolEntry`, `AgentState`, `ToolReference`, `SkillDefinition`, `HTTPAuth` and its variants), and a structural `ExecutionSpanEmitter` interface.
  - **@agntz/core**: the moved vocabulary/utilities now live in `@agntz/contracts`; core imports the canonical shapes from there and re-exports them from their original module paths, so core's public surface and `instanceof` behavior are unchanged. This deletes the hand-copied structural mirrors of manifest's `HTTPToolEntry`/`AgentState`/`HTTPAuth` types (the bidirectional duplication is gone). The `TokenExchangeAuth.apply` mirror drift is resolved to optional, matching the token resolver, which already defaults a missing `apply`.
  - The manifest DSL (which ships in `@agntz/core`) consumes the kernel's vocabulary directly — no local copies — and types its `ExecutionContext.spanEmitter` against the structural `ExecutionSpanEmitter` (which core's concrete `SpanEmitter` satisfies).

- 6d35efe: Make the store and resource adapters depend only on `@agntz/contracts` (ports-and-adapters).

  - **@agntz/contracts** now owns the full data/contract layer: the storage **ports** (`UnifiedStore` + all sub-store interfaces, `ResourceProvider`/`ResourceToolContext`/`ResourceProviderToolDefinition`), the **entity types** (`AgentDefinition`, `Run`/`Session`/`Message`/`Trace`/`Span`, `Secret*`, `ApiKeyRecord`, `Connection*`, `ProviderConfig`, the full `Eval*` family, `InvokeResult`/`ContentBlock`/`TokenUsage`, …), the **model-call shapes** (`ModelProvider`, `GenerateTextOptions`/`Result`, `ModelStreamResult`), and the pure leaf utils (secret crypto, namespace grants, `defineSkill`, `listEvalRunsInProcess`). It gains a type-only `zod` dependency for `ResourceProviderToolDefinition.input`. The runtime execution types (`ToolDefinition`/`ToolContext`/`InvokeOptions`, `RunRegistry`, streaming, telemetry sinks) stay in `@agntz/core`.
  - **@agntz/core** imports those shapes from `@agntz/contracts` and re-exports them from their original module paths — its public surface and `instanceof` behavior are unchanged.
  - **@agntz/store-postgres / @agntz/store-sqlite** now depend on `@agntz/contracts` instead of `@agntz/core` — they implement the store ports without pulling in the runtime (no more transitive AI-SDK provider deps).
  - **@agntz/memrez** depends on `@agntz/contracts` (not `@agntz/core`). Its reasoner no longer constructs core's `AISDKModelProvider`; instead it accepts an injected `ModelProvider` via the new `modelProvider` option on `createMemrez`/the reasoner. **Behavior change:** LLM-backed curation/tagging now requires a host to inject a `ModelProvider` (e.g. `new AISDKModelProvider()`); the worker does this automatically. Store/read/scan paths are unaffected.
