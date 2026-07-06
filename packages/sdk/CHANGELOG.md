# @agntz/sdk

## 0.0.1

### Patch Changes

- 7f0fbac: Fix invalid `dist/index.d.ts` emitted for the `tool()` helper. The source imported zod's `infer` type under a local alias, and declaration bundling resolved the alias back to the bare name `infer` — a reserved keyword in type positions — so the shipped declarations failed to typecheck in consuming projects. `tool()` now uses zod's canonical `TypeOf` name (the same type `infer` aliases), which bundles to valid declarations.

## 0.0.0 - 2026-06-26

- Establish the public baseline for the TypeScript SDK.
- Includes local YAML manifest execution, hosted client access, CLI entrypoints, memory integration, SQLite helpers, traces, runs, sessions, and spawn/parity support.
- Earlier npm releases were experimental pre-baseline iterations and are deprecated on the registry.
