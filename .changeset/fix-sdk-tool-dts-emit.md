---
"@agntz/sdk": patch
---

Fix invalid `dist/index.d.ts` emitted for the `tool()` helper. The source imported zod's `infer` type under a local alias, and declaration bundling resolved the alias back to the bare name `infer` — a reserved keyword in type positions — so the shipped declarations failed to typecheck in consuming projects. `tool()` now uses zod's canonical `TypeOf` name (the same type `infer` aliases), which bundles to valid declarations.
