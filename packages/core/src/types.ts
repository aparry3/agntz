import type {
	AgentStore,
	ContextStore,
	InvokeResult,
	LogStore,
	ModelProvider,
	NamespaceGrantPolicy,
	OutboundUrlPolicyOptions,
	ResourceMode,
	ResourceProvider,
	Run,
	SessionStore,
	SkillStore,
	Span,
	TokenUsage,
	ToolCallRecord,
	ToolReference,
	TraceSummary,
	UnifiedStore,
} from "@agntz/contracts";
/**
 * Core runtime types.
 *
 * The data types, store/resource ports, and model-call shapes now live in
 * `@agntz/contracts` (the store and resource adapters consume them without
 * depending on core). They are re-exported verbatim at the bottom of this file
 * so core's public surface and its many internal `./types.js` imports are
 * unchanged.
 *
 * What stays here are the genuinely runtime-coupled types — the ones whose
 * fields reference core-only runtime constructs (`SpanEmitter`, `TokenCache`,
 * the in-process `RunRegistry`) or that are intrinsically tied to the runner's
 * execution model (`InvokeOptions`, `StreamEvent`, `RunnerConfig`, …).
 */
import type { ZodSchema } from "zod";
import type { TokenCache } from "./auth/index.js";
import type { SpanEmitter, TelemetryConfig } from "./telemetry.js";

// ═══════════════════════════════════════════════════════════════════════
// Tool System
// ═══════════════════════════════════════════════════════════════════════

export interface ToolDefinition<
	TInput = unknown,
	TCtx extends Record<string, unknown> = Record<string, unknown>,
> {
	name: string;
	description: string;
	input: ZodSchema<TInput>;
	contextWrite?: { pattern: string };
	execute(input: TInput, ctx: ToolContext & TCtx): Promise<unknown>;
}

export interface ToolContext {
	/** ID of the agent executing this tool */
	agentId: string;
	/** Session ID (if conversational) */
	sessionId?: string;
	/**
	 * Normalized namespace capability grants for this invocation. These are
	 * minted by trusted application code via InvokeOptions.context and are
	 * propagated to child invocations narrow-only.
	 */
	context?: string[];
	/** Active context bucket IDs */
	contextIds?: string[];
	/** Unique ID for the current invocation */
	invocationId: string;
	/** Invoke another agent */
	invoke(
		agentId: string,
		input: string,
		options?: InvokeOptions,
	): Promise<InvokeResult>;
	/** ID of the Run executing this tool, if running under a RunRegistry */
	runId?: string;
	/** The owning user (set when the runner store is user-scoped) */
	userId?: string;
	/**
	 * Run registry, when the runner is wired to one. The `spawn_agent` tool
	 * uses this to create child Runs without blocking the current loop.
	 */
	runRegistry?: RunRegistry;
	/** Skills already loaded in this run (use_skill tool reads/writes this). */
	loadedSkills?: Set<string>;
	/** SkillStore used by the use_skill tool to fetch definitions on demand. */
	skillStore?: SkillStore;
	/**
	 * Callback the use_skill tool invokes to wire a loaded skill's tools into
	 * the live tool registry and report descriptors back to the model. The
	 * runner supplies this in the per-call ToolContext.
	 */
	registerSkillTools?: (refs: ToolReference[]) => Promise<
		Array<{
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		}>
	>;
	/** Spread toolContext values */
	[key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════
// Invocation
// ═══════════════════════════════════════════════════════════════════════

export interface InvokeOptions {
	/** Enables conversational continuity */
	sessionId?: string;
	/**
	 * Runtime namespace capability grants. These are generic resource grants,
	 * not message context buckets. Child invocations inherit this grant set
	 * unless they explicitly request a narrowed subset.
	 */
	context?: string[];
	/** Named context buckets to inject */
	contextIds?: string[];
	/** Ad-hoc context string injected into messages */
	extraContext?: string;
	/** Runtime data available to tool execute() via ctx */
	toolContext?: Record<string, unknown>;
	/** Return async iterable instead of awaiting */
	stream?: boolean;
	/** Cancellation */
	signal?: AbortSignal;
	/**
	 * Maximum tool call loop iterations (default: 10). Clamped against
	 * `AgentDefinition.maxSteps` if set — callers can tighten the agent's
	 * ceiling but not raise above it.
	 */
	maxSteps?: number;
	/**
	 * Cumulative token budget across all steps. Clamped against
	 * `AgentDefinition.tokenBudget` if set; callers can tighten only. When the
	 * running `totalUsage.totalTokens` reaches this value, the next iteration
	 * throws `TokenBudgetExceededError`.
	 */
	tokenBudget?: number;
	/**
	 * Wall-clock budget in milliseconds. Clamped against
	 * `AgentDefinition.timeoutMs` if set; callers can tighten only. When the
	 * timer fires, the in-flight model call aborts and the runner throws
	 * `InvocationTimeoutError` — distinct from `InvocationCancelledError`.
	 */
	timeoutMs?: number;
	/** @internal Recursion depth tracker for agent-as-tool chains */
	_recursionDepth?: number;
	/** @internal Effective parent resource modes by resource kind. */
	_resourceModes?: Record<string, ResourceMode>;
	/**
	 * Run registry for non-blocking child agent spawning. When set, the runner
	 * registers `spawn_agent` and `check_agents` tools (if the agent declares
	 * `spawnable`) and threads the registry through `ToolContext.runRegistry`.
	 */
	runRegistry?: RunRegistry;
	/**
	 * The Run id that this invocation is executing under. The runner creates
	 * one if absent and a registry is provided.
	 */
	runId?: string;
	/** Parent Run id (set by `spawn_agent` for child invocations). */
	parentRunId?: string;
	/** The owning user, propagated to ToolContext. */
	userId?: string;
	/** Per-invocation SpanEmitter. When provided, child spans nest under whatever
	 *  span is at the top of its stack. Bridge constructs one per request. */
	spanEmitter?: SpanEmitter;
	/** Tenant scoping for emitted spans. Threaded from the worker bridge so
	 *  invoke/model/tool spans get the right owner_id. */
	ownerId?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Streaming
// ═══════════════════════════════════════════════════════════════════════

export type StreamEvent =
	| { type: "text-delta"; text: string }
	| { type: "tool-call-start"; toolCall: { id: string; name: string } }
	| { type: "tool-call-end"; toolCall: ToolCallRecord }
	| { type: "step-complete"; step: number; toolCalls: ToolCallRecord[] }
	/**
	 * Intermediate reply delivered via the synthetic `reply` tool. Yielded by
	 * `Runner.stream` in real time as the model invokes the reply tool, so SSE
	 * consumers see partial output mid-loop instead of waiting for `done`. The
	 * same reply is still aggregated onto `InvokeResult.replies` for the final
	 * `done` payload — adding this event is purely additive.
	 */
	| {
			type: "reply";
			text: string;
			ts: string;
			sessionId: string;
			runId: string;
	  }
	| { type: "done"; result: InvokeResult };

export interface InvokeStream extends AsyncIterable<StreamEvent> {
	/** Await the final result (consumes the stream) */
	result: Promise<InvokeResult>;
}

// ═══════════════════════════════════════════════════════════════════════
// Runner Configuration
// ═══════════════════════════════════════════════════════════════════════

export interface RunnerConfig {
	/** Single store for all concerns */
	store?: UnifiedStore;
	/** Or split by concern */
	agentStore?: AgentStore;
	sessionStore?: SessionStore;
	contextStore?: ContextStore;
	logStore?: LogStore;

	/** Inline tools */
	tools?: ToolDefinition[];

	/** MCP server configuration */
	mcp?: {
		servers: Record<string, MCPServerConfig>;
	};

	/** Session trimming */
	session?: {
		maxMessages?: number;
		maxTokens?: number;
		strategy?: "sliding" | "summary" | "none";
	};

	/** Context injection limits */
	context?: {
		maxEntries?: number;
		maxTokens?: number;
		strategy?: "latest" | "summary" | "all";
	};

	/** Resource providers keyed by resource kind. */
	resources?: Record<string, ResourceProvider>;

	/**
	 * Optional guardrail for runtime namespace grants. Use this to mark
	 * sensitive namespace branches that must never receive broad grants.
	 */
	namespacePolicy?: NamespaceGrantPolicy;

	/** Custom model provider (bypasses ai package) */
	modelProvider?: ModelProvider;

	/** Default model config */
	defaults?: {
		model?: { provider: string; name: string };
		temperature?: number;
		maxTokens?: number;
	};

	/** Retry configuration for model calls */
	retry?: {
		/** Maximum number of retries (default: 2) */
		maxRetries?: number;
		/** Initial delay in milliseconds (default: 1000) */
		initialDelayMs?: number;
		/** Backoff multiplier (default: 2) */
		backoffMultiplier?: number;
		/** Maximum delay in milliseconds (default: 30000) */
		maxDelayMs?: number;
	};

	/** Maximum recursion depth for agent-as-tool chains (default: 3) */
	maxRecursionDepth?: number;

	/** OpenTelemetry configuration (opt-in) */
	telemetry?: TelemetryConfig;

	/**
	 * Resolves `{{env.<NAME>}}` template references in HTTP tool params/headers
	 * to their values. Embedded use cases (`@agntz/sdk`) typically wire this
	 * to `process.env`; hosted/multi-tenant servers leave it unset so env refs
	 * throw at invoke time (prevents user manifests from reading server env).
	 */
	envProvider?: (name: string) => string | undefined;

	/**
	 * Cache backend for HTTP tool auth tokens (oauth2_client_credentials /
	 * token_exchange). Defaults to in-memory; swap in a persistent backend
	 * for hosted/multi-process deployments to avoid token churn on cold
	 * starts.
	 */
	tokenCache?: TokenCache;

	/**
	 * Server-side outbound URL policy for user-controlled HTTP, MCP, image,
	 * token exchange, and webhook fetches. Defaults block localhost/private
	 * networks and DNS answers that resolve to them.
	 */
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
}

export interface MCPServerConfig {
	/** HTTP URL for the MCP server (Streamable HTTP / SSE) */
	url: string;
	/** Optional headers for HTTP requests */
	headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════
// Runs — first-class agent invocations, decoupled from any HTTP request
// ═══════════════════════════════════════════════════════════════════════

/** Public handle returned by `spawn_agent` to the LLM. */
export interface RunHandle {
	run_id: string;
	agent_id: string;
	status: "running";
}

/** A child completion queued for delivery to its parent's next turn. */
export interface PendingChildResult {
	parentRunId: string;
	childRunId: string;
	toolUseId?: string;
	agentId: string;
	payload:
		| { ok: true; output: string; usage: TokenUsage }
		| { ok: false; error: string; cancelled?: boolean };
}

/**
 * Multiplexed event from a Run subtree. Subscribed-to via
 * `RunRegistry.subscribe(rootId)`. Each event carries the Run it came from
 * and a monotonic `seq` so consumers can resume after a disconnect.
 */
export type MultiplexedEvent =
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
			toolCall: ToolCallRecord;
			seq: number;
	  }
	| {
			type: "step-complete";
			runId: string;
			step: number;
			toolCalls: ToolCallRecord[];
			seq: number;
	  }
	| { type: "draining"; runId: string; pendingChildren: string[]; seq: number }
	/**
	 * Intermediate reply delivered via the synthetic `reply` tool. Phase 4 will
	 * forward these to SSE consumers; the registry already broadcasts them.
	 */
	| {
			type: "reply";
			runId: string;
			sessionId: string;
			text: string;
			ts: string;
			seq: number;
	  }
	| { type: "run-complete"; runId: string; result: InvokeResult; seq: number }
	| { type: "run-error"; runId: string; error: string; seq: number }
	| { type: "run-cancelled"; runId: string; seq: number };

export interface SpawnRunOptions {
	agentId: string;
	/** ISO timestamp of the resolved version (set by the runner / bridge). */
	agentVersion?: string;
	/** What the caller passed as the version suffix, preserved on the Run. */
	requestedAgentVersion?: string;
	input: string;
	parentRunId?: string;
	spawnToolUseId?: string;
	userId?: string;
	sessionId?: string;
	/** Per-run span emitter for emitting a run-kind span on lifecycle events.
	 *  When omitted, the registry doesn't emit run spans for this Run. */
	spanEmitter?: SpanEmitter;
}

/**
 * In-process registry for Runs. Holds AbortController tree, replay buffers,
 * and the pending-child-result queue. Runs themselves are also persisted via
 * `RunStore` if one is wired in.
 */
export interface RunRegistry {
	/** Create a Run record but do not start execution. */
	create(opts: SpawnRunOptions): Run;
	/**
	 * Begin executing a Run (fire-and-forget). The executor is given the Run's
	 * AbortSignal and must return the InvokeResult. The registry handles
	 * completion/error bookkeeping when the executor's promise settles.
	 */
	start(
		run: Run,
		executor: (signal: AbortSignal) => Promise<InvokeResult>,
	): void;
	/** Look up a Run by id. */
	get(runId: string): Run | undefined;
	/** Direct children of a Run. */
	children(parentRunId: string): Run[];
	/** Cancel a Run and cascade to all descendants. */
	cancel(runId: string, reason?: string): void;
	/**
	 * Atomically take all queued completions for a parent. Used by the runner
	 * at the top of each iteration to inject deferred tool results.
	 */
	consumePending(parentRunId: string): PendingChildResult[];
	/** Number of children of `parentRunId` not yet in a terminal state. */
	outstandingChildrenCount(parentRunId: string): number;
	/** Resolves when the next child of `parentRunId` settles (or signal aborts). */
	awaitNextSettled(parentRunId: string, signal?: AbortSignal): Promise<void>;
	/** Resolves when all children of `parentRunId` have settled. */
	drain(parentRunId: string, signal?: AbortSignal): Promise<void>;
	/** Subscribe to multiplexed events from the subtree rooted at `rootId`. */
	subscribe(rootId: string, sinceSeq?: number): AsyncIterable<MultiplexedEvent>;
	/**
	 * Emit a multiplexed event into the root's stream. The runner uses this to
	 * surface text-delta, tool-call, step-complete, and draining events. The
	 * registry stamps each event with a monotonic `seq`.
	 */
	emit(rootId: string, event: MultiplexedEvent): void;
	/**
	 * Mark a Run as completed. Used by the runner to settle a Run that wasn't
	 * started via `start()` (i.e. top-level invocations). Idempotent.
	 */
	notifyCompleted(runId: string, result: InvokeResult): void;
	/**
	 * Mark a Run as failed (or cancelled, if its abort signal is aborted).
	 * Idempotent.
	 */
	notifyFailed(runId: string, err: unknown): void;
	/**
	 * Return the runId of the currently-active (pre-terminal) Run for the
	 * given sessionId, or undefined if there is none. Used by the runner's
	 * cancel-and-replace logic to detect and supersede an in-flight invoke
	 * on the same session.
	 */
	findActiveBySession(sessionId: string): string | undefined;
	/**
	 * Acquire a per-session mutex. The returned function must be called to
	 * release the lock — typically in a `finally` block. Pending acquirers
	 * are served FIFO so cancel-and-replace decisions on the same session
	 * serialize cleanly without TOCTOU races.
	 */
	acquireSessionLock(sessionId: string): Promise<() => void>;
	/**
	 * Resolve when the given runId reaches a terminal status (completed,
	 * failed, or cancelled). Resolves immediately if already terminal.
	 * Resolves (does not reject) if the run is unknown to the registry.
	 */
	waitForTerminal(runId: string): Promise<void>;
	/**
	 * Return the AbortSignal driving the Run's internal controller. The
	 * runner uses this for top-level invokes — which never go through
	 * `start()` — so that `cancel(runId)` can still abort a mid-loop model
	 * call. Returns undefined for unknown runIds.
	 */
	getAbortSignal(runId: string): AbortSignal | undefined;
}

// ═══════════════════════════════════════════════════════════════════════
// Traces — live events bridged from the in-process SpanEmitter
// ═══════════════════════════════════════════════════════════════════════

/**
 * Live event published to subscribers of an in-progress trace. The registry
 * emits these in real time; the worker forwards them over SSE.
 */
export type TraceLiveEvent =
	| { type: "span-start"; span: Span }
	| { type: "span-end"; spanId: string; patch: Partial<Span> }
	| { type: "trace-done"; summary: TraceSummary };

/**
 * Callback the SpanEmitter calls on every span-start / span-end / trace-done.
 * The TraceRegistry implements this; pass it via `RunnerConfig.telemetry.traceSink`.
 */
export type TraceSink = (event: TraceLiveEvent) => void;

// ═══════════════════════════════════════════════════════════════════════
// Re-exports — the data types, store/resource ports, and model-call shapes
// now live in `@agntz/contracts`. Listed explicitly (not `export *`) so they
// don't collide with core's other contracts re-exports.
// ═══════════════════════════════════════════════════════════════════════

export {
	DEFAULT_REPLY_MAX_PER_RUN,
	isContentBlockArray,
} from "@agntz/contracts";
export type {
	// Multimodal
	ContentBlock,
	ImageMediaType,
	// Agent
	AgentDefinition,
	AgentRef,
	ModelConfig,
	ResourceDefinition,
	ResourceMode,
	ResourceProvider,
	ResourceProviderToolDefinition,
	ResourceRegistrationContext,
	ResourceToolContext,
	// Tools
	ToolReference,
	ToolInfo,
	// Invocation
	InvokeResult,
	ToolCallRecord,
	TokenUsage,
	// Messages & Sessions
	Message,
	SessionSummary,
	SessionSnapshot,
	// Context
	ContextEntry,
	// Logs
	InvocationLog,
	LogFilter,
	// Store Interfaces
	AgentStore,
	AgentVersionSummary,
	SessionStore,
	ContextStore,
	LogStore,
	ProviderStore,
	ProviderConfig,
	ConnectionStore,
	Connection,
	ConnectionKind,
	ConnectionConfig,
	MCPConnectionConfig,
	ScopableStore,
	UnifiedStore,
	// Skills
	SkillDefinition,
	SkillStore,
	// Secrets
	SecretDefinition,
	SecretMetadata,
	SecretStore,
	// Replies
	Reply,
	// Runs
	Run,
	RunListFilters,
	RunListResult,
	RunStatus,
	RunStore,
	// Evals
	EvalCriterion,
	EvalCriterionGate,
	EvalDefinition,
	EvalDefaultDatasetRef,
	EvalInput,
	EvalDatasetItem,
	EvalDataset,
	EvalDatasetVersionSummary,
	EvalCriterionResult,
	EvalCaseStatus,
	EvalOutcome,
	EvalCaseResult,
	EvalRunStatus,
	EvalRunSummary,
	EvalRunSnapshots,
	EvalRun,
	EvalListFilters,
	EvalDatasetListFilters,
	EvalRunListFilters,
	EvalRunListResult,
	EvalLatestScore,
	EvalLatestScoreKey,
	EvalLatestScoreListFilters,
	EvalJudgeConfig,
	EvalStore,
	EvalPassPolicy,
	EvalVersionSummary,
	// Traces
	SpanKind,
	SpanStatus,
	Span,
	TraceSummary,
	TraceFilter,
	TraceStore,
	// Model Provider
	ModelProvider,
	ModelStreamResult,
	GenerateTextOptions,
	GenerateTextResult,
} from "@agntz/contracts";
