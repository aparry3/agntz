// Factory + client
export { agntz } from "./client.js";
export type {
	AgntzLocalOptions,
	LocalClient,
	LocalAgentsResource,
	LocalDatasetsResource,
	LocalEvalsResource,
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
export { tool } from "./tools.js";
export type { ToolDefinition, ToolContext } from "@agntz/core";

// Re-export zod so users define schemas without a separate install.
export { z } from "zod";

// Type parity with @agntz/client: re-export so user code written against the
// HTTP client shape works against the runner with a single import-line change.
export type {
	RunInput,
	RunResult,
	StreamEvent,
	Reply,
	ContentBlock,
	ImageMediaType,
	EvalCaseResult,
	EvalCaseStatus,
	EvalCriterion,
	EvalCriterionResult,
	EvalDataset,
	EvalDatasetItem,
	EvalDatasetListFilter,
	EvalDefinition,
	EvalLatestScore,
	EvalLatestScoreKey,
	EvalLatestScoreListFilter,
	EvalListFilter,
	EvalRun,
	EvalRunInput,
	EvalRunListFilter,
	EvalRunListResult,
	EvalRunStatus,
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
} from "@agntz/client";
