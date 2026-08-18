# @agntz/core

## 0.5.0

### Minor Changes

- 15e4df1: Upgrade to the current AI SDK provider adapters and refresh built-in model
  defaults, pricing, and templates for the August 2026 provider catalogs.

### Patch Changes

- Updated dependencies [15e4df1]
  - @agntz/contracts@0.4.1

## 0.4.0

### Minor Changes

- Add versioned provider-native batch manifests, staged reusable dataset imports,
  durable batch reconciliation, normalized results, and model-run comparisons.

### Patch Changes

- Updated dependencies
  - @agntz/contracts@0.4.0

## 0.3.0

### Minor Changes

- Add manifest-declared, invocation-scoped client tools for hosted and embedded
  agents. Client tools fail before run creation when a required handler is
  missing, remain attached through one public run or stream call, and surface
  handler failures and deadlines as model-visible tool errors.

### Patch Changes

- Updated dependencies
  - @agntz/contracts@0.3.0

## 0.2.0

### Minor Changes

- fc75bce: Add the provider-replacement hosted AI surface: canonical recursive JSON
  Schema, common and provider-scoped model settings, ordered multimodal content,
  managed artifacts, transcription and image-generation manifests, typed signed
  callback tools, normalized result metadata, and explicit none/result/session
  retention. The TypeScript and Python clients now share a public-contract parity
  gate.
- fc75bce: Publish the agent-manifest JSON Schema, preserve and validate complete HTTP tool-agent request/auth configuration, make MCP a complete runtime dependency, deduplicate store shutdown, and align the core runtime on Node 22.

### Patch Changes

- Updated dependencies [fc75bce]
- Updated dependencies [fc75bce]
  - @agntz/contracts@0.2.0

## 0.0.0 - 2026-06-26

- Establish the public baseline for the TypeScript core runtime.
- Includes runner orchestration, agents, tools, MCP integration, model-provider adapters, manifest execution, sessions, traces, telemetry hooks, namespace grants, and shared runtime exports.
- Earlier npm releases were experimental pre-baseline iterations and are deprecated on the registry.
