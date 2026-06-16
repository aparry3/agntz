---
"@agntz/contracts": minor
"@agntz/store-postgres": minor
"@agntz/store-sqlite": minor
"@agntz/memrez": minor
"@agntz/core": patch
---

Make the store and resource adapters depend only on `@agntz/contracts` (ports-and-adapters).

- **@agntz/contracts** now owns the full data/contract layer: the storage **ports** (`UnifiedStore` + all sub-store interfaces, `ResourceProvider`/`ResourceToolContext`/`ResourceProviderToolDefinition`), the **entity types** (`AgentDefinition`, `Run`/`Session`/`Message`/`Trace`/`Span`, `Secret*`, `ApiKeyRecord`, `Connection*`, `ProviderConfig`, the full `Eval*` family, `InvokeResult`/`ContentBlock`/`TokenUsage`, …), the **model-call shapes** (`ModelProvider`, `GenerateTextOptions`/`Result`, `ModelStreamResult`), and the pure leaf utils (secret crypto, namespace grants, `defineSkill`, `listEvalRunsInProcess`). It gains a type-only `zod` dependency for `ResourceProviderToolDefinition.input`. The runtime execution types (`ToolDefinition`/`ToolContext`/`InvokeOptions`, `RunRegistry`, streaming, telemetry sinks) stay in `@agntz/core`.
- **@agntz/core** imports those shapes from `@agntz/contracts` and re-exports them from their original module paths — its public surface and `instanceof` behavior are unchanged.
- **@agntz/store-postgres / @agntz/store-sqlite** now depend on `@agntz/contracts` instead of `@agntz/core` — they implement the store ports without pulling in the runtime (no more transitive AI-SDK provider deps).
- **@agntz/memrez** depends on `@agntz/contracts` (not `@agntz/core`). Its reasoner no longer constructs core's `AISDKModelProvider`; instead it accepts an injected `ModelProvider` via the new `modelProvider` option on `createMemrez`/the reasoner. **Behavior change:** LLM-backed curation/tagging now requires a host to inject a `ModelProvider` (e.g. `new AISDKModelProvider()`); the worker does this automatically. Store/read/scan paths are unaffected.
