---
"@agntz/core": minor
"@agntz/sdk": patch
"@agntz/worker": patch
---

Deduplicate the manifest→runner execution bridge shared by the embedded SDK and the hosted worker.

- **@agntz/core** gains `createManifestExecutionContext(runner, opts)` (+ `ManifestExecutionContextOptions`, `ManifestBridgeHooks`) — the single shared implementation of the manifest `ExecutionContext` (`invokeLLM`/`invokeTool`, output parsing, temp-agent lifecycle). Both hosts previously re-implemented this; they now supply only their environment-specific seams (`resolveAgent` source, temp-agent cleanup, `spawnable` pre-registration, local-tool dispatch, observability hooks) and delegate the shared mechanics here. The exported `createExecutionContext` signatures in `@agntz/sdk` and `@agntz/worker` are unchanged, so call sites are untouched.
- **@agntz/worker** — parity/bug fix: `http` **pipeline tool steps** now forward `body`/`body_type`/`auth` and the runner's `tokenResolver`/`tokenCache`, which the worker previously dropped (authed or bodied http pipeline steps worked in the embedded SDK but silently misfired hosted). The `[llm]`/`[tool]` console breadcrumbs are preserved via the new hooks. Minor edge-case alignment: an explicit empty `state.userQuery` is now used verbatim as the user message (matching the SDK) instead of being replaced by the serialized state.
- **@agntz/sdk** — drops its hand-rolled namespace-grant validators in favor of `@agntz/contracts`' canonical `normalizeNamespaceGrants`/`narrowNamespaceGrants` (re-exported by `@agntz/core`). Validation rules are identical; malformed grants now throw a typed `NamespaceGrantError` instead of a plain `Error`.

Internal consolidation; no public API changes beyond the new `@agntz/core` exports.
