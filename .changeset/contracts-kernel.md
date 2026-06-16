---
"@agntz/contracts": minor
"@agntz/core": patch
---

Introduce `@agntz/contracts`, the shared-vocabulary kernel, and route `@agntz/core` through it.

- **@agntz/contracts** (new): a zero-runtime-dependency package for the vocabulary and pure leaf utilities both core and manifest need — the outbound-URL policy (SSRF guard + hardened fetch), the agent-ref parser (`parseAgentRef`/`formatAgentRef`/`ParsedAgentRef`), the base error types (`AgntzError`, `InvalidAgentRefError`), the declarative HTTP-tool / auth / skill config (`HTTPToolEntry`, `AgentState`, `ToolReference`, `SkillDefinition`, `HTTPAuth` and its variants), and a structural `ExecutionSpanEmitter` interface.
- **@agntz/core**: the moved vocabulary/utilities now live in `@agntz/contracts`; core imports the canonical shapes from there and re-exports them from their original module paths, so core's public surface and `instanceof` behavior are unchanged. This deletes the hand-copied structural mirrors of manifest's `HTTPToolEntry`/`AgentState`/`HTTPAuth` types (the bidirectional duplication is gone). The `TokenExchangeAuth.apply` mirror drift is resolved to optional, matching the token resolver, which already defaults a missing `apply`.
- The manifest DSL (which ships in `@agntz/core`) consumes the kernel's vocabulary directly — no local copies — and types its `ExecutionContext.spanEmitter` against the structural `ExecutionSpanEmitter` (which core's concrete `SpanEmitter` satisfies).
