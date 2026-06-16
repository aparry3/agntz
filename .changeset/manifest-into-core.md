---
"@agntz/core": minor
"@agntz/sdk": patch
"@agntz/worker": patch
---

Merge `@agntz/manifest` into `@agntz/core` and remove the standalone package.

The YAML manifest engine (parser, validator, template engine, state, and the graph executor) now ships as part of `@agntz/core`, exposed at the **`@agntz/core/manifest`** subpath. Import its API from there instead of `@agntz/manifest` — the standalone package is removed. The DSL itself is unchanged; this is a packaging consolidation (manifest and the runtime are always used together). `@agntz/sdk` and `@agntz/worker` are repointed to the subpath.
