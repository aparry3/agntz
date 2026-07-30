export interface AgntzClientOptions {
	apiKey: string;
	baseUrl: string;
	fetch?: typeof fetch;
	defaultSignal?: AbortSignal;
}

/**
 * IANA media types accepted by multimodal image blocks. Mirrors
 * `@agntz/core`'s `ImageMediaType` — duplicated so the SDK has no runtime
 * dependency on core.
 */
export type ImageMediaType =
	| "image/jpeg"
	| "image/png"
	| "image/gif"
	| "image/webp";

export type ImageDetail = "auto" | "low" | "high";

export type LocalArtifactInput =
	| Blob
	| ArrayBuffer
	| Uint8Array
	| { path: string; mediaType?: string; filename?: string };

export interface ArtifactRef {
	id: string;
	ownerId: string;
	purpose: "input" | "output";
	mediaType: string;
	sizeBytes: number;
	sha256: string;
	createdAt: string;
	expiresAt: string;
	status: "ready" | "deleted" | "failed";
	downloadUrl?: string;
}

/**
 * One block of a multimodal user message. Either a text fragment or an
 * image referenced by URL (fetched server-side) or already-base64-encoded
 * body. Mirrors `@agntz/core`'s `ContentBlock`.
 */
export type ContentBlock =
	| { type: "text"; text: string }
	| {
			type: "image";
			url: string;
			headers?: Record<string, string>;
			mediaType?: ImageMediaType;
			detail?: ImageDetail;
	  }
	| {
			type: "image";
			base64: string;
			mediaType: ImageMediaType;
			detail?: ImageDetail;
	  }
	| {
			type: "image";
			artifactId: string;
			mediaType?: ImageMediaType;
			detail?: ImageDetail;
	  }
	| {
			type: "image";
			file: LocalArtifactInput;
			mediaType?: ImageMediaType;
			detail?: ImageDetail;
	  }
	| {
			type: "audio";
			artifactId: string;
			mediaType?: string;
	  }
	| { type: "audio"; base64: string; mediaType: string }
	| {
			type: "audio";
			url: string;
			headers?: Record<string, string>;
			mediaType?: string;
	  }
	| { type: "audio"; file: LocalArtifactInput; mediaType?: string };

/** Wire-safe rich content after local files have been uploaded. */
export type WireContentBlock = Exclude<
	ContentBlock,
	{ file: LocalArtifactInput }
>;

export interface RetentionRequest {
	mode?: "none" | "result" | "session";
	ttlSeconds?: number;
	artifactTtlSeconds?: number;
}

export interface ClientToolContext {
	requestId: string;
	toolCallId: string;
	runId: string;
	/** ISO timestamp after which the worker rejects this tool result. */
	deadlineAt: string;
	signal: AbortSignal;
}

export type ClientToolHandler = (
	input: unknown,
	context: ClientToolContext,
) => unknown | Promise<unknown>;

export type ClientToolHandlers = Record<string, ClientToolHandler>;

export interface RunInput {
	agentId: string;
	/**
	 * Agent input. For LLM agents this is typically a string or a
	 * `ContentBlock[]` (for multimodal MMS-style inputs); for non-LLM
	 * tool/manifest agents it can be any JSON value the manifest is wired to
	 * consume.
	 */
	input?: unknown | string | ContentBlock[];
	/** Exact ordered user/media message, independent from structured input. */
	content?: ContentBlock[];
	/** Forward-compat: worker accepts but ignores today. */
	sessionId?: string;
	/** Runtime namespace capability grants passed through to resource providers. */
	context?: string[];
	retention?: RetentionRequest;
	/**
	 * Application-local handlers for manifest-declared `kind: client` tools.
	 * They are attached only for this run and are never sent as source code.
	 */
	clientTools?: ClientToolHandlers;
	signal?: AbortSignal;
}

export interface RunResult {
	output: unknown;
	state: Record<string, unknown>;
	runId: string;
	traceId?: string;
	status: "completed";
	requestedAgentVersion?: string;
	resolvedAgentVersion?: string;
	provider?: string;
	model: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	finishReason?: string;
	responseId?: string;
	warnings?: string[];
	/**
	 * Session this run executed under. Present for `session` retention; omitted
	 * for `none` and `result`, which intentionally do not create history.
	 */
	sessionId?: string;
	retention?: RetentionRequest;
	/**
	 * Intermediate replies the agent emitted via the `reply` tool during this
	 * run. Only present when at least one reply was sent. Each entry was also
	 * persisted to the session at the moment of the call, so a later
	 * `getMessages(sessionId)` will see them in conversation history.
	 */
	replies?: Reply[];
}

/**
 * One intermediate user-facing message emitted mid-run via the agent's
 * `reply` tool. Mirrors `@agntz/core`'s `Reply` — duplicated so the SDK has
 * no runtime dependency on core.
 */
export interface Reply {
	text: string;
	/** ISO 8601 timestamp the reply was emitted at. */
	ts: string;
	sessionId: string;
	runId: string;
}

export type AgentKind =
	| "llm"
	| "tool"
	| "sequential"
	| "parallel"
	| "transcription"
	| "image";

export type StreamEvent =
	| {
			type: "start";
			agentId: string;
			kind: AgentKind;
			sessionId?: string;
			retention?: RetentionRequest;
			/** Durable root Run created for this invocation (newer workers). */
			runId?: string;
			/** Trace associated with the root Run (newer workers). */
			traceId?: string;
	  }
	| {
			type: "complete";
			output: unknown;
			state: Record<string, unknown>;
			sessionId?: string;
			retention?: RetentionRequest;
	  }
	/**
	 * Intermediate reply delivered via the agent's `reply` tool. Emitted in
	 * real time as the model invokes the tool — the final `complete` event
	 * still carries any `replies` aggregated server-side. `seq` is present on
	 * the multiplexed `/runs/:id/stream` variant; on `/run/stream` it's the
	 * registry-stamped sequence number when one is wired, or undefined when
	 * the worker drives the stream directly.
	 */
	| {
			type: "reply";
			text: string;
			ts: string;
			sessionId: string;
			runId: string;
			seq?: number;
	  }
	| { type: "error"; error: string };

export interface HealthResult {
	status: string;
	service: string;
}

export interface AgentSummary {
	id: string;
	name: string;
	description?: string;
}

export interface AgentDefinition {
	id: string;
	name: string;
	description?: string;
	systemPrompt?: string;
	model?: {
		provider: string;
		name: string;
		temperature?: number;
		maxTokens?: number;
		topP?: number;
		options?: Record<string, unknown>;
	};
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface AgentImportItem {
	id?: string;
	manifest: string;
	sourcePath?: string;
}

export interface AgentImportInput {
	agents: AgentImportItem[];
	onConflict?: "version" | "skip" | "fail";
	dryRun?: boolean;
	strict?: boolean;
	signal?: AbortSignal;
}

export interface AgentImportResult {
	id: string;
	sourcePath?: string;
	action: "create" | "version" | "skip" | "update";
	warnings?: unknown[];
}

export interface AgentImportResponse {
	dryRun: boolean;
	results: AgentImportResult[];
	counts: Record<string, number>;
}

export interface SessionSnapshot {
	sessionId: string;
	agentId?: string;
	messages: Array<{
		role: "system" | "user" | "assistant" | "tool";
		content: string | ContentBlock[];
		toolCalls?: unknown[];
		toolCallId?: string;
		timestamp: string;
	}>;
	createdAt?: string;
	updatedAt?: string;
}

export interface SessionImportInput {
	sessions: SessionSnapshot[];
	onConflict?: "skip" | "fail";
	dryRun?: boolean;
	signal?: AbortSignal;
}

export interface SessionImportResult {
	sessionId: string;
	agentId?: string;
	action: "create" | "version" | "skip" | "update";
	messageCount: number;
}

export interface SessionImportResponse {
	dryRun: boolean;
	results: SessionImportResult[];
	counts: Record<string, number>;
}

export interface SessionSummary {
	sessionId: string;
	agentId?: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface SessionDetail {
	sessionId: string;
	messages: SessionSnapshot["messages"];
}

export interface MemoryEntry {
	id: string;
	scope: string;
	content: string;
	topics: string[];
	type: "fact" | "preference" | "event" | "summary";
	source?: { agentId?: string; sessionId?: string; runId?: string };
	status: "active" | "superseded";
	supersededBy?: string;
	createdAt: string;
	updatedAt: string;
}

export interface MemoryImportInput {
	entries: MemoryEntry[];
	dryRun?: boolean;
	signal?: AbortSignal;
}

export interface MemoryImportResult {
	id: string;
	scope: string;
	action: "create" | "version" | "skip" | "update";
	status: MemoryEntry["status"];
}

export interface MemoryImportResponse {
	dryRun: boolean;
	results: MemoryImportResult[];
	counts: Record<string, number>;
}

export interface MemoryTopicSummary {
	topic: string;
	count: number;
	blurb?: string;
	lastUpdatedAt: string;
	hasUncuratedWrites: boolean;
}

export interface MemoryScanResult {
	grants: string[];
	topics: MemoryTopicSummary[];
}

export interface MemoryEntriesPage {
	entries: MemoryEntry[];
	total: number;
	limit: number;
	offset: number;
}

export interface MemoryReadOptions {
	limit?: number;
	signal?: AbortSignal;
}

export interface MemoryListOptions {
	topics?: string[];
	includeSuperseded?: boolean;
	limit?: number;
	offset?: number;
	signal?: AbortSignal;
}

export interface MemoryDeleteEntryResult {
	deleted: boolean;
	id: string;
}

export interface MemoryCurateReport {
	scanned: number;
	superseded: number;
	created: number;
	blurbsUpdated: number;
}

export interface MemoryCurateResult {
	curateEnabled: boolean;
	report: MemoryCurateReport;
}

/** Result of `POST /scopes/delete` — counts deleted per resource provider. */
export interface ScopeDeleteResult {
	scope: string;
	recursive: boolean;
	total: number;
	byResource: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────
// /evals, /datasets, /eval-runs
// ─────────────────────────────────────────────────────────────────────────

export interface EvalCriterion {
	id: string;
	name: string;
	description?: string;
	weight?: number;
	threshold?: number;
}

export interface EvalDefinition {
	id: string;
	agentId: string;
	name: string;
	description?: string;
	criteria: EvalCriterion[];
	defaultDatasetId?: string;
	passThreshold?: number;
	judgeModel?: {
		provider: string;
		name: string;
		temperature?: number;
		maxTokens?: number;
		topP?: number;
		options?: Record<string, unknown>;
	};
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface EvalDatasetItem {
	id: string;
	name?: string;
	input: string | Record<string, unknown> | WireContentBlock[];
	expected?: unknown;
	metadata?: Record<string, unknown>;
}

export interface EvalDataset {
	id: string;
	agentId?: string;
	name: string;
	description?: string;
	items: EvalDatasetItem[];
	itemCount?: number;
	metadata?: Record<string, unknown>;
	version?: string;
	createdAt?: string;
	updatedAt?: string;
}

export type DatasetItem = EvalDatasetItem;
export type Dataset = EvalDataset;

export interface DatasetItemsPage {
	rows: DatasetItem[];
	cursor?: string;
}

export interface DatasetImportResult {
	id: string;
	datasetId: string;
	name: string;
	description?: string;
	agentId?: string;
	status: "open" | "completed";
	itemCount: number;
	createdAt: string;
	updatedAt: string;
	datasetVersion?: string;
}

export interface DatasetImportInput {
	source:
		| string
		| Blob
		| ArrayBuffer
		| Uint8Array
		| DatasetItem[]
		| { path: string };
	format?: "jsonl" | "csv";
	datasetId?: string;
	name?: string;
	description?: string;
	agentId?: string;
	metadata?: Record<string, unknown>;
	idColumn?: string;
	inputColumn?: string;
	signal?: AbortSignal;
}

export interface BatchDefinition {
	id: string;
	name?: string;
	description?: string;
	manifest: string;
	provider: string;
	model: string;
	defaultDataset?: { id: string; version?: string };
	version?: string;
	createdAt?: string;
	updatedAt?: string;
}

export type BatchSummary = Omit<BatchDefinition, "manifest">;

export interface BatchVersionSummary {
	createdAt: string;
	activatedAt?: string | null;
	aliases: string[];
}

export type BatchRunStatus =
	| "validating"
	| "submitting"
	| "queued"
	| "running"
	| "cancelling"
	| "completed"
	| "failed"
	| "expired"
	| "cancelled";

export type BatchItemStatus =
	| "pending"
	| "succeeded"
	| "failed"
	| "expired"
	| "cancelled";

export interface BatchRequestCounts {
	total: number;
	pending: number;
	succeeded: number;
	failed: number;
	expired: number;
	cancelled: number;
}

export interface BatchRun {
	id: string;
	batchId: string;
	requestedBatchVersion?: string;
	batchVersion: string;
	datasetId?: string;
	requestedDatasetVersion?: string;
	datasetVersion?: string;
	provider: string;
	model: string;
	providerBatchId?: string;
	providerStatus?: string;
	status: BatchRunStatus;
	counts: BatchRequestCounts;
	snapshot: {
		batch: BatchDefinition;
		dataset?: Omit<Dataset, "items"> & { itemCount: number };
		inlineDataset?: boolean;
	};
	callbackUrl?: string;
	webhookSecretName?: string;
	createdAt: string;
	submittedAt?: string;
	startedAt?: string;
	endedAt?: string;
	providerExpiresAt?: string;
	error?: string;
}

export interface BatchRunItem {
	runId: string;
	itemId: string;
	ordinal: number;
	name?: string;
	input: DatasetItem["input"];
	metadata?: Record<string, unknown>;
	status: BatchItemStatus;
	output?: unknown;
	rawOutput?: string;
	error?: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	finishReason?: string;
	providerRequestId?: string;
	durationMs?: number;
}

export interface BatchRunInput {
	batchId: string;
	batchVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	items?: DatasetItem[];
	callbackUrl?: string;
	webhookSecretName?: string;
	idempotencyKey?: string;
	signal?: AbortSignal;
}

export interface BatchRunListFilter {
	batchId?: string;
	batchVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	provider?: string;
	model?: string;
	status?: BatchRunStatus;
	startedAfter?: string;
	startedBefore?: string;
	limit?: number;
	cursor?: string;
}

export interface BatchRunListResult {
	rows: BatchRun[];
	cursor?: string;
}

export interface BatchRunItemsPage {
	rows: BatchRunItem[];
	cursor?: string;
}

export interface BatchRunComparisonResult {
	leftRun: BatchRun;
	rightRun: BatchRun;
	rows: Array<{
		itemId: string;
		input?: DatasetItem["input"];
		left?: BatchRunItem;
		right?: BatchRunItem;
	}>;
	cursor?: string;
	datasetVersionsMatch: boolean;
}

export interface EvalCriterionResult {
	score: number;
	passed: boolean;
	reason: string;
}

export type EvalCaseStatus = "completed" | "failed" | "skipped" | "cancelled";

export interface EvalCaseResult {
	itemId: string;
	status: EvalCaseStatus;
	input: string | Record<string, unknown> | WireContentBlock[];
	expected?: unknown;
	output?: string;
	agentRunId?: string;
	invocationId?: string;
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	duration?: number;
	criteria: Record<string, EvalCriterionResult>;
	score: number;
	passed: boolean;
	reason?: string;
	error?: string;
}

export type EvalRunStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface EvalRun {
	id: string;
	evalId: string;
	datasetId: string;
	agentId: string;
	agentVersion?: string;
	requestedAgentVersion?: string;
	status: EvalRunStatus;
	startedAt: string;
	endedAt?: string;
	snapshots: {
		eval: EvalDefinition;
		dataset: EvalDataset;
		agent: unknown;
		agentVersion?: string;
		requestedAgentVersion?: string;
	};
	caseResults: EvalCaseResult[];
	summary?: {
		totalCases: number;
		completedCases: number;
		failedCases: number;
		skippedCases: number;
		overallScore: number;
		passed: boolean;
		criteria: Record<
			string,
			{ score: number; passed: boolean; completedCases: number }
		>;
	};
	error?: string;
}

export interface EvalRunInput {
	evalId: string;
	datasetId?: string;
	agentVersion?: string;
	signal?: AbortSignal;
}

export interface EvalListFilter {
	agentId?: string;
}

export interface EvalRunListFilter {
	agentId?: string;
	evalId?: string;
	datasetId?: string;
	status?: EvalRunStatus;
	startedAfter?: string;
	startedBefore?: string;
	limit?: number;
	cursor?: string;
}

export interface EvalRunListResult {
	rows: EvalRun[];
	cursor?: string;
}

export interface EvalDatasetListFilter {
	agentId?: string;
}

export interface EvalLatestScoreKey {
	evalId: string;
	datasetId: string;
	resolvedAgentVersion?: string;
}

export interface EvalLatestScoreListFilter {
	agentId?: string;
	evalId?: string;
	datasetId?: string;
	resolvedAgentVersion?: string;
	status?: EvalRunStatus;
}

export interface EvalLatestScore {
	evalId: string;
	datasetId: string;
	agentId: string;
	requestedAgentVersion?: string;
	resolvedAgentVersion?: string;
	runId: string;
	status: EvalRunStatus;
	summary?: EvalRun["summary"];
	overallScore: number;
	passed: boolean;
	startedAt: string;
	endedAt?: string;
	updatedAt: string;
}

/** @internal */
export interface SseFrame {
	event?: string;
	data: string;
	id?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// /runs/* — long-lived, observable Run resources
// ─────────────────────────────────────────────────────────────────────────

export type RunStatus =
	| "pending"
	| "running"
	| "draining"
	| "completed"
	| "failed"
	| "cancelled";

/**
 * Server-side Run record returned by POST /runs and GET /runs/:id. Fields
 * mirror @agntz/core's `Run` interface — duplicated here so the SDK has no
 * runtime dependency on core.
 */
export interface Run {
	id: string;
	rootId: string;
	parentId?: string;
	agentId: string;
	agentVersion?: string;
	requestedAgentVersion?: string;
	userId?: string;
	sessionId?: string;
	retentionMode?: "none" | "result" | "session";
	expiresAt?: string;
	spawnToolUseId?: string;
	status: RunStatus;
	input: string;
	result?: {
		output: string;
		invocationId: string;
		sessionId: string;
		toolCalls: Array<{
			id: string;
			name: string;
			input: unknown;
			output: unknown;
			duration: number;
			error?: string;
		}>;
		usage: {
			promptTokens: number;
			completionTokens: number;
			totalTokens: number;
		};
		duration: number;
		model: string;
		provider?: string;
		requestedModel?: string;
		responseId?: string;
		finishReason?: string;
		rawFinishReason?: string;
		warnings?: string[];
	};
	error?: string;
	startedAt: number;
	endedAt?: number;
	depth: number;
}

export interface RunsStartInput {
	agentId: string;
	/** See `RunInput.input` for the accepted shapes. */
	input?: unknown | string | ContentBlock[];
	content?: ContentBlock[];
	sessionId?: string;
	/** Runtime namespace capability grants passed through to resource providers. */
	context?: string[];
	retention?: RetentionRequest;
	signal?: AbortSignal;
	/**
	 * Per-invocation webhook callback URL. When set, the worker will POST
	 * intermediate `reply` events and a final `complete` event to this URL,
	 * signed with the secret named by `webhookSecretName` (HMAC-SHA256,
	 * `X-Agntz-Signature` header).
	 *
	 * If `callbackUrl` is set, `webhookSecretName` is required.
	 */
	callbackUrl?: string;
	/**
	 * Name of the SecretStore entry whose plaintext is the HMAC signing key.
	 * Resolved by name at each delivery attempt, so an out-of-band regenerate
	 * is picked up automatically (the consumer must redeploy with the new
	 * value to verify the new signatures).
	 */
	webhookSecretName?: string;
}

export interface RunsStreamInput {
	runId: string;
	/** Resume from a specific seq (exclusive); useful after reconnect. */
	since?: number;
	signal?: AbortSignal;
}

/** Filter passed to RunsResource.list. `userId` is implicit (auth). */
export interface RunListFilter {
	rootsOnly?: boolean;
	agentId?: string;
	status?: RunStatus;
	startedAfter?: string;
	startedBefore?: string;
	limit?: number;
	cursor?: string;
}

export interface RunListResult {
	rows: Run[];
	cursor?: string;
}

/**
 * Multiplexed event from a Run subtree, as exposed via GET /runs/:id/stream.
 * Mirrors @agntz/core's `MultiplexedEvent` — duplicated to keep the SDK free
 * of a core runtime dep.
 */
export type MultiplexedRunEvent =
	| {
			type: "run-spawn";
			runId: string;
			parentId?: string;
			agentId: string;
			seq: number;
	  }
	| { type: "text-delta"; runId: string; text: string; seq: number }
	| {
			type: "tool-call-start";
			runId: string;
			toolCall: { id: string; name: string };
			seq: number;
	  }
	| {
			type: "tool-call-end";
			runId: string;
			toolCall: {
				id: string;
				name: string;
				input: unknown;
				output: unknown;
				duration: number;
				error?: string;
			};
			seq: number;
	  }
	| {
			type: "step-complete";
			runId: string;
			step: number;
			toolCalls: Array<{
				id: string;
				name: string;
				input: unknown;
				output: unknown;
				duration: number;
				error?: string;
			}>;
			seq: number;
	  }
	| { type: "draining"; runId: string; pendingChildren: string[]; seq: number }
	/**
	 * Intermediate reply delivered via the agent's `reply` tool. Surfaced on
	 * the multiplexed subtree feed in real time; same record (text + ts +
	 * sessionId + runId) is also aggregated onto the final `run-complete`
	 * result.replies for clients that prefer batch delivery.
	 */
	| {
			type: "reply";
			runId: string;
			sessionId: string;
			text: string;
			ts: string;
			seq: number;
	  }
	| { type: "run-complete"; runId: string; result: Run["result"]; seq: number }
	| { type: "run-error"; runId: string; error: string; seq: number }
	| { type: "run-cancelled"; runId: string; seq: number }
	/** Emitted when the run has been evicted from memory and only a final snapshot is available. */
	| { type: "snapshot"; run: Run };

// ─── Traces ────────────────────────────────────────────────────────────

export type SpanKind =
	| "run"
	| "manifest"
	| "step"
	| "invoke"
	| "model"
	| "tool";
export type SpanStatus = "running" | "ok" | "error" | "cancelled";

export interface Span {
	spanId: string;
	traceId: string;
	parentId: string | null;
	ownerId: string;
	runId: string | null;
	sessionId: string | null;
	name: string;
	kind: SpanKind;
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	status: SpanStatus;
	error: string | null;
	attributes: Record<string, unknown>;
	events: Array<{ ts: string; name: string; data?: unknown }>;
	scores: Record<string, { value: number; reason?: string }>;
	costUsd: number | null;
}

export interface TraceSummary {
	traceId: string;
	ownerId: string;
	rootName: string;
	agentId: string | null;
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	spanCount: number;
	status: SpanStatus;
	totalTokens: number;
	totalCostUsd: number | null;
}

/** Filter passed to TracesResource.list. `ownerId` is implicit (auth). */
export interface TraceFilter {
	agentId?: string;
	status?: SpanStatus;
	startedAfter?: string;
	startedBefore?: string;
	limit?: number;
	cursor?: string;
}

export type TraceLiveEvent =
	| { type: "span-start"; span: Span }
	| { type: "span-end"; spanId: string; patch: Partial<Span> }
	| { type: "trace-done"; summary: TraceSummary }
	| { type: "snapshot"; summary: TraceSummary; spans: Span[] };

export interface TracesListResult {
	rows: TraceSummary[];
	cursor?: string;
}

export interface TraceDetail {
	summary: TraceSummary;
	spans: Span[];
}
