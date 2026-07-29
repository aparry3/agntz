# @agntz/sdk

## 0.2.0

### Minor Changes

- fc75bce: Add durable local runs and traces, persisted agent version references, lifecycle cleanup, end-to-end cancellation, recursive CLI validation, and strict packed-package coverage.

### Patch Changes

- Updated dependencies [fc75bce]
- Updated dependencies [fc75bce]
- Updated dependencies [fc75bce]
- Updated dependencies [fc75bce]
  - @agntz/client@0.2.0
  - @agntz/stores@0.2.0
  - @agntz/core@0.2.0

## 0.0.1

### Patch Changes

- 7f0fbac: Fix invalid `dist/index.d.ts` emitted for the `tool()` helper. The source imported zod's `infer` type under a local alias, and declaration bundling resolved the alias back to the bare name `infer` — a reserved keyword in type positions — so the shipped declarations failed to typecheck in consuming projects. `tool()` now uses zod's canonical `TypeOf` name (the same type `infer` aliases), which bundles to valid declarations.

## 0.0.0 - 2026-06-26

- Establish the public baseline for the TypeScript SDK.
- Includes local YAML manifest execution, hosted client access, CLI entrypoints, memory integration, SQLite helpers, traces, runs, sessions, and spawn/parity support.
- Earlier npm releases were experimental pre-baseline iterations and are deprecated on the registry.
