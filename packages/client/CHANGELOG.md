# @agntz/client

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

- fc75bce: Promote the hosted TypeScript client and its run, trace, import, memory, and eval resource types to public beta with Node 22 support and packed-consumer coverage.
- fc75bce: Add the provider-replacement hosted AI surface: canonical recursive JSON
  Schema, common and provider-scoped model settings, ordered multimodal content,
  managed artifacts, transcription and image-generation manifests, typed signed
  callback tools, normalized result metadata, and explicit none/result/session
  retention. The TypeScript and Python clients now share a public-contract parity
  gate.

## 0.0.0 - 2026-06-26

- Establish the public baseline for the hosted TypeScript HTTP client.
- Includes agents, sessions, runs, streaming, memory, traces, datasets, evals, eval runs, and latest-score APIs.
- Earlier npm releases were experimental pre-baseline iterations and are deprecated on the registry.
