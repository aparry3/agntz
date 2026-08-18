# @agntz/sdk

## 0.3.3

### Patch Changes

- Updated dependencies [0830de8]
  - @agntz/core@0.5.1

## 0.3.2

### Patch Changes

- 15e4df1: Upgrade to the current AI SDK provider adapters and refresh built-in model
  defaults, pricing, and templates for the August 2026 provider catalogs.
- Updated dependencies [15e4df1]
  - @agntz/core@0.5.0
  - @agntz/stores@0.3.1

## 0.3.1

### Patch Changes

- Updated dependencies
  - @agntz/core@0.4.0
  - @agntz/stores@0.3.0
  - @agntz/client@0.4.0

## 0.3.0

### Minor Changes

- Add manifest-declared, invocation-scoped client tools for hosted and embedded
  agents. Client tools fail before run creation when a required handler is
  missing, remain attached through one public run or stream call, and surface
  handler failures and deadlines as model-visible tool errors.

### Patch Changes

- Updated dependencies
  - @agntz/client@0.3.0
  - @agntz/core@0.3.0
  - @agntz/stores@0.2.1

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
