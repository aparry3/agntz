// Factory + client
export { agntz } from "./client.js";
export type {
  AgntzLocalOptions,
  LocalClient,
  LocalAgentsResource,
  LocalRunsResource,
  LocalTracesResource,
} from "./client.js";

// Loader (exposed for tests and advanced cases)
export {
  loadManifestsFromDir,
  loadManifestFromFile,
  parseManifestString,
} from "./loader.js";

// Local tools
export type { LocalToolHandler, LocalToolMap } from "./tools.js";

// Type parity with @agntz/sdk: re-export so user code written against the
// SDK shape works against the runner with a single import-line change.
export type {
  RunInput,
  RunResult,
  StreamEvent,
  Reply,
  ContentBlock,
  ImageMediaType,
  Run,
  RunListFilter,
  RunListResult,
  RunStatus,
  Span,
  SpanKind,
  SpanStatus,
  TraceDetail,
  TraceFilter,
  TraceSummary,
  TracesListResult,
} from "@agntz/sdk";
