# @agntz/stores

## 0.3.1

### Patch Changes

- Updated dependencies [15e4df1]
  - @agntz/contracts@0.4.1
  - @agntz/db@0.2.1

## 0.3.0

### Minor Changes

- Add versioned provider-native batch manifests, staged reusable dataset imports,
  durable batch reconciliation, normalized results, and model-run comparisons.

### Patch Changes

- Updated dependencies
  - @agntz/contracts@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies
  - @agntz/contracts@0.3.0

## 0.2.0

### Minor Changes

- fc75bce: Persist requested and resolved agent-version metadata in SQLite and Postgres, add live integration coverage, and ship complete adapter declarations.
- fc75bce: Add the provider-replacement hosted AI surface: canonical recursive JSON
  Schema, common and provider-scoped model settings, ordered multimodal content,
  managed artifacts, transcription and image-generation manifests, typed signed
  callback tools, normalized result metadata, and explicit none/result/session
  retention. The TypeScript and Python clients now share a public-contract parity
  gate.

### Patch Changes

- Updated dependencies [fc75bce]
- Updated dependencies [fc75bce]
- Updated dependencies [fc75bce]
  - @agntz/contracts@0.2.0
  - @agntz/db@0.2.0

## 0.0.0 - 2026-06-26

- Initial public release.
- Establishes the consolidated TypeScript storage package with contracts, memory, SQLite, and Postgres store implementations.
- Replaces the retired `@agntz/store-postgres` and `@agntz/store-sqlite` packages.
