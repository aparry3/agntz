# @agntz/contracts

## 0.4.0

### Minor Changes

- Add versioned provider-native batch manifests, staged reusable dataset imports,
  durable batch reconciliation, normalized results, and model-run comparisons.

## 0.3.0

### Minor Changes

- Add manifest-declared, invocation-scoped client tools for hosted and embedded
  agents. Client tools fail before run creation when a required handler is
  missing, remain attached through one public run or stream call, and surface
  handler failures and deadlines as model-visible tool errors.

## 0.2.0

### Minor Changes

- fc75bce: Promote the shared runtime, run, trace, eval, resource, and agent-version contracts to the coordinated public-beta line, with Node 22 as the supported runtime floor.
- fc75bce: Add the provider-replacement hosted AI surface: canonical recursive JSON
  Schema, common and provider-scoped model settings, ordered multimodal content,
  managed artifacts, transcription and image-generation manifests, typed signed
  callback tools, normalized result metadata, and explicit none/result/session
  retention. The TypeScript and Python clients now share a public-contract parity
  gate.

## 0.0.0 - 2026-06-26

- Initial public release.
- Establishes the shared TypeScript contract package for storage ports, resource ports, agent/run/session/trace/eval shapes, HTTP/auth vocabulary, namespace utilities, and leaf errors/utilities.
