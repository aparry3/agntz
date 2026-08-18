import type { ZodSchema } from "zod";
import type { SkillDefinition, ToolReference } from "./tools.js";

export type RetentionMode = "none" | "result" | "session";

export interface RetentionPolicy {
	mode: RetentionMode;
	/** Optional expiry for durable result/session records. */
	ttlSeconds?: number;
	/** Optional independent expiry for uploaded or generated artifacts. */
	artifactTtlSeconds?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Agent Definition — the core portable data structure
// ═══════════════════════════════════════════════════════════════════════

export interface AgentDefinition {
	/** Unique identifier (e.g., "code-reviewer") */
	id: string;
	/** Human-readable name */
	name: string;
	/** What this agent does */
	description?: string;
	/** Semantic version */
	version?: string;

	/** The agent's instructions */
	systemPrompt: string;
	/** Few-shot examples */
	examples?: Array<{ input: string; output: string }>;
	/** Template with {{input}} placeholder */
	userPromptTemplate?: string;

	/** Model configuration */
	model: ModelConfig;

	/** References to tools by name/source */
	tools?: ToolReference[];

	/**
	 * Agents this agent is allowed to spawn as concurrent children at runtime
	 * via the `spawn_agent` tool. Predefined per agent — the LLM cannot spawn
	 * arbitrary agents. If absent or empty, `spawn_agent` and `check_agents`
	 * are not registered and the LLM cannot spawn at all.
	 */
	spawnable?: AgentRef[];

	/** Skills the agent may load mid-run via the synthetic `use_skill` tool. Names resolve in `SkillStore`. */
	skills?: string[];

	/**
	 * Resource declarations this agent may use. The core runner wires these
	 * through registered ResourceProviders; resource-specific behavior lives in
	 * the provider, not on the agent.
	 */
	resources?: Record<string, ResourceDefinition>;

	/**
	 * When set, the runner registers a per-invocation `reply` tool the model
	 * can call to deliver intermediate messages to the user. Each call is
	 * persisted to the session immediately, surfaced on `InvokeResult.replies`,
	 * and (when a `RunRegistry` is wired) emitted as a multiplexed `reply`
	 * event. Pass `true` for defaults or an object to override `maxPerRun`.
	 */
	reply?: boolean | { maxPerRun?: number };

	/** Structured output constraint (JSON Schema) */
	outputSchema?: Record<string, unknown>;

	/** If true, output auto-writes to context */
	contextWrite?: boolean;

	/**
	 * Resource limits this agent defaults to. Callers can tighten via
	 * `InvokeOptions` but cannot raise above these ceilings — the runner takes
	 * `min(agent, options)`. Omit a field to leave that limit uncapped (or fall
	 * back to the runner's hard default, in the case of `maxSteps`).
	 */
	/** Hard ceiling on tool-call loop iterations for one invocation. */
	maxSteps?: number;
	/**
	 * Hard ceiling on cumulative model token usage (prompt + completion across
	 * all steps) for one invocation. When exceeded, the next loop iteration
	 * throws `TokenBudgetExceededError`.
	 */
	tokenBudget?: number;
	/**
	 * Wall-clock budget in milliseconds for one invocation. When the timer
	 * fires, the in-flight model call aborts and the runner throws
	 * `InvocationTimeoutError` — distinguishable from a user-cancel. Omit for
	 * no timeout.
	 */
	timeoutMs?: number;
	/** Default persistence policy. Callers may override it per invocation. */
	retention?: RetentionPolicy;

	/** Arbitrary tags for categorization */
	tags?: string[];
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface ModelConfig {
	/** Provider name: "openai", "anthropic", "google", etc. */
	provider: string;
	/** Model name: "gpt-5.6-sol", "claude-sonnet-5", etc. */
	name: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	topK?: number;
	presencePenalty?: number;
	frequencyPenalty?: number;
	stopSequences?: string[];
	seed?: number;
	maxRetries?: number;
	/** Provider-scoped AI SDK options. */
	providerOptions?: Record<string, Record<string, unknown>>;
	/** @deprecated Use providerOptions. */
	options?: Record<string, unknown>;
}

export type ResourceMode = "read" | "read-write";

export interface ResourceDefinition {
	/** Provider kind. Defaults to the manifest resource name when omitted. */
	kind: string;
	/** Per-agent access mode. Providers may define kind-specific defaults. */
	mode?: ResourceMode;
	/** Optional static provider input. It is not an automatic grant. */
	namespace?: string | string[];
	/** Provider-specific config passthrough. */
	config?: unknown;
	/** Additional provider-specific fields from manifest YAML. */
	[key: string]: unknown;
}

export interface ResourceRegistrationContext {
	resourceName: string;
	kind: string;
	mode: ResourceMode;
	config: ResourceDefinition;
}

export interface ResourceToolContext {
	resourceName: string;
	kind: string;
	mode: ResourceMode;
	config: ResourceDefinition;
	grants: string[];
	run: {
		runId?: string;
		sessionId?: string;
		agentId?: string;
		invocationId?: string;
	};
}

export interface ResourceProviderToolDefinition<TInput = unknown> {
	/** Provider-local name. The runner exposes it as <resourceName>_<name>. */
	name: string;
	description: string;
	input: ZodSchema<TInput>;
	/** Defaults to "read"; read-write tools are omitted in read mode. */
	mode?: ResourceMode;
	execute(input: TInput, ctx: ResourceToolContext): Promise<unknown>;
}

export interface ResourceProvider {
	/**
	 * Default mode when an agent omits resource.mode. Resource-specific
	 * providers may choose read-write (memory) or read (RAG/files).
	 */
	defaultMode?: ResourceMode;
	tools?(ctx: ResourceRegistrationContext): ResourceProviderToolDefinition[];
	getContext?(ctx: ResourceToolContext): Promise<string | undefined>;
	/**
	 * Hard-delete everything this provider holds at-or-below `grant` (GDPR-style
	 * scope erasure). Generic over providers — it speaks only a namespace grant
	 * string and a deleted count, never resource-specific types. Providers with
	 * no namespace-addressable data omit it. The host (worker/SDK) iterates the
	 * registered providers and aggregates the results: core defines the
	 * capability, hosts orchestrate. Idempotent — safe to re-run.
	 */
	purgeScope?(
		grant: string,
		opts?: { recursive?: boolean },
	): Promise<{ deleted: number }>;
}

// ═══════════════════════════════════════════════════════════════════════
// Tool System
// ═══════════════════════════════════════════════════════════════════════

// `ToolReference` and `SkillDefinition` are shared vocabulary defined in
// `./tools.js`; the contracts barrel re-exports them from there directly.

/**
 * Reference to an agent that can be spawned as a child Run.
 * Either by ID into the AgentStore (optionally pinned to `@latest` or a
 * specific ISO timestamp), or inline-defined at runtime.
 */
export type AgentRef =
	| { kind: "ref"; agentId: string; version?: string }
	| { kind: "inline"; definition: AgentDefinition };

export interface ToolInfo {
	name: string;
	description: string;
	source: "inline" | `mcp:${string}`;
	inputSchema: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Invocation
// ═══════════════════════════════════════════════════════════════════════

export interface InvokeResult {
	/** The agent's final text response */
	output: string;
	/** Unique ID for this invocation */
	invocationId: string;
	/**
	 * Session this invocation ran under. Always set — the runner auto-allocates
	 * one if the caller didn't pass `options.sessionId`. Callers should record
	 * this id to continue the conversation on later invokes.
	 */
	sessionId: string;
	/** All tool calls made during execution */
	toolCalls: ToolCallRecord[];
	/** Token usage */
	usage: TokenUsage;
	/** Milliseconds */
	duration: number;
	/** Model used */
	model: string;
	/** Provider selected for the final model operation. */
	provider?: string;
	/** Model name requested by the active agent version. */
	requestedModel?: string;
	/** Provider response/request id, when available. */
	responseId?: string;
	/** Normalized finish reason for the final model operation. */
	finishReason?: string;
	/** Provider-native finish reason, when available. */
	rawFinishReason?: string;
	/** Provider warnings normalized to readable strings. */
	warnings?: string[];
	/**
	 * Intermediate replies the agent delivered during this invocation via the
	 * synthetic `reply` tool. Only present when at least one reply was sent.
	 * Each entry is persisted to the session at the moment of the call so
	 * conversation history reflects partial output even on cancellation.
	 */
	replies?: Reply[];
}

/**
 * One intermediate user-facing message emitted mid-run via the `reply` tool.
 * Surfaced on `InvokeResult.replies` and (when a RunRegistry is wired) as a
 * multiplexed `reply` event.
 */
export interface Reply {
	text: string;
	/** ISO 8601 timestamp the reply was emitted at. */
	ts: string;
	sessionId: string;
	runId: string;
}

/**
 * Default `reply` tool rate limit. Caps `InvokeResult.replies.length` and
 * the number of accepted reply tool calls per invocation. Overridable per
 * agent via `AgentDefinition.reply.maxPerRun`.
 */
export const DEFAULT_REPLY_MAX_PER_RUN = 50;

export interface ToolCallRecord {
	id: string;
	name: string;
	input: unknown;
	output: unknown;
	duration: number;
	error?: string;
}

export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	model?: string;
	inputTokenDetails?: {
		noCacheTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	outputTokenDetails?: {
		textTokens?: number;
		reasoningTokens?: number;
	};
	/** Deprecated AI SDK alias; prefer outputTokenDetails.reasoningTokens. */
	reasoningTokens?: number;
	/** Deprecated AI SDK alias; prefer inputTokenDetails.cacheReadTokens. */
	cachedInputTokens?: number;
	/** Per-call cost in USD reported by the provider (e.g. OpenRouter). */
	cost?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Messages & Sessions
// ═══════════════════════════════════════════════════════════════════════

/**
 * Supported image media types. The image fetcher allow-list is intentionally
 * narrow — adding a new type requires updating both this union and the fetch
 * validator in `image-fetcher.ts`.
 */
export type ImageMediaType =
	| "image/jpeg"
	| "image/png"
	| "image/gif"
	| "image/webp";
export type ImageDetail = "auto" | "low" | "high";

/**
 * One block of a multimodal message. Text blocks pass through to the model
 * as-is; image blocks may reference a URL (fetched lazily by the runner) or
 * an already-base64-encoded body.
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
	| { type: "audio"; base64: string; mediaType: string }
	| {
			type: "audio";
			url: string;
			headers?: Record<string, string>;
			mediaType?: string;
	  }
	| { type: "audio"; artifactId: string; mediaType?: string };

/**
 * Type guard for `ContentBlock[]`. Returns true only for non-empty arrays
 * where every element is a well-formed text/image block. Used by the runner
 * and message-builder to discriminate between legacy string input and the new
 * multimodal parts payload.
 */
export function isContentBlockArray(input: unknown): input is ContentBlock[] {
	if (!Array.isArray(input)) return false;
	if (input.length === 0) return false;
	for (const block of input) {
		if (!block || typeof block !== "object") return false;
		const b = block as Record<string, unknown>;
		if (b.type === "text") {
			if (typeof b.text !== "string") return false;
		} else if (b.type === "image") {
			const hasUrl = typeof b.url === "string";
			const hasBase64 = typeof b.base64 === "string";
			const hasArtifact = typeof b.artifactId === "string";
			if (!hasUrl && !hasBase64 && !hasArtifact) return false;
			if (hasBase64 && typeof b.mediaType !== "string") return false;
		} else if (b.type === "audio") {
			const hasUrl = typeof b.url === "string";
			const hasBase64 = typeof b.base64 === "string";
			const hasArtifact = typeof b.artifactId === "string";
			if (!hasUrl && !hasBase64 && !hasArtifact) return false;
			if (hasBase64 && typeof b.mediaType !== "string") return false;
		} else {
			return false;
		}
	}
	return true;
}

export interface Message {
	role: "system" | "user" | "assistant" | "tool";
	/**
	 * Either a plain string (legacy / single-text payload) or a `ContentBlock[]`
	 * for multimodal user messages. Stores persist the blocks array alongside a
	 * flattened text view; readers must accept both shapes.
	 */
	content: string | ContentBlock[];
	toolCalls?: ToolCallRecord[];
	toolCallId?: string;
	timestamp: string;
}

export interface SessionSummary {
	sessionId: string;
	agentId?: string;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface SessionSnapshot {
	sessionId: string;
	agentId?: string;
	messages: Message[];
	createdAt?: string;
	updatedAt?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Context
// ═══════════════════════════════════════════════════════════════════════

export interface ContextEntry {
	contextId: string;
	agentId: string;
	invocationId: string;
	content: string;
	createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Invocation Logs
// ═══════════════════════════════════════════════════════════════════════

export interface InvocationLog {
	id: string;
	agentId: string;
	sessionId?: string;
	/**
	 * Original invocation input. Plain string for legacy/text-only callers; a
	 * `ContentBlock[]` for multimodal (e.g. MMS-image) callers. Readers must
	 * accept both shapes — log views render text and ignore image bodies.
	 */
	input: string | ContentBlock[];
	output: string;
	toolCalls: ToolCallRecord[];
	usage: TokenUsage;
	duration: number;
	model: string;
	error?: string;
	/**
	 * Final disposition of this invocation. Recorded for auditability so the
	 * token bill, tool calls, and any partial output of cancelled runs are
	 * still attributable. Optional for backward compat — older log rows that
	 * predate this field are treated as `completed` unless `error` is set.
	 */
	status?: "completed" | "cancelled" | "failed";
	timestamp: string;
}

export interface LogFilter {
	agentId?: string;
	sessionId?: string;
	since?: string;
	limit?: number;
	offset?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Store Interfaces
// ═══════════════════════════════════════════════════════════════════════

export interface AgentVersionSummary {
	createdAt: string;
	activatedAt: string | null;
	/** Human-readable aliases pointing at this version (`stable`, `prod`, …). */
	aliases: string[];
}

export interface AgentStore {
	getAgent(id: string): Promise<AgentDefinition | null>;
	listAgents(): Promise<
		Array<{ id: string; name: string; description?: string }>
	>;
	putAgent(agent: AgentDefinition): Promise<void>;
	deleteAgent(id: string): Promise<void>;

	/** List all stored versions of an agent, most recent first. */
	listAgentVersions(agentId: string): Promise<AgentVersionSummary[]>;
	/** Fetch a specific version by its created_at timestamp. */
	getAgentVersion(
		agentId: string,
		createdAt: string,
	): Promise<AgentDefinition | null>;
	/** Mark a specific version as the active one. */
	activateAgentVersion(agentId: string, createdAt: string): Promise<void>;
	/**
	 * Resolve a version alias (`stable`, `prod`, …) to its createdAt timestamp.
	 * Returns `null` if no version carries that alias.
	 */
	resolveAgentAlias(agentId: string, alias: string): Promise<string | null>;
	/**
	 * Point an alias at a specific version. Reassigns the alias if it already
	 * exists on another version of the same agent (aliases are unique per agent).
	 * Throws if the version doesn't exist.
	 */
	setAgentVersionAlias(
		agentId: string,
		createdAt: string,
		alias: string,
	): Promise<void>;
	/** Drop an alias from any version it currently points at. No-op if absent. */
	removeAgentVersionAlias(agentId: string, alias: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
// Skills — reusable (instruction + tools) bundles an LLM agent can opt into
// mid-run. See packages/core/src/tools/use-skill.ts for the synthetic tool
// the runner registers when an agent declares skills.
// ═══════════════════════════════════════════════════════════════════════

// `SkillDefinition` is shared vocabulary defined in `./tools.js`.
export interface SkillStore {
	getSkill(name: string): Promise<SkillDefinition | null>;
	listSkills(): Promise<Array<{ name: string; description: string }>>;
	putSkill(skill: SkillDefinition): Promise<void>;
	deleteSkill(name: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
// Secrets — per-user encrypted credentials referenced by HTTP tools (and
// other future template consumers) as `{{secrets.<name>}}`. Values are
// AES-256-GCM encrypted at rest; only the runtime fetches plaintext.
// ═══════════════════════════════════════════════════════════════════════

export interface SecretDefinition {
	/** Referenced as `{{secrets.<name>}}` in agent manifests. */
	name: string;
	/** Plaintext at the API boundary; encrypted at rest by the store. */
	value: string;
	description?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface SecretMetadata {
	name: string;
	description?: string;
	/** Last 4 chars of plaintext for masked-UI display (e.g. `••••5678`). */
	lastFour: string;
	createdAt: string;
	updatedAt: string;
}

export interface SecretStore {
	listSecrets(): Promise<SecretMetadata[]>;
	getSecretMetadata(name: string): Promise<SecretMetadata | null>;
	/** Decrypted value — runtime only; never expose via an HTTP API route. */
	getSecretValue(name: string): Promise<string | null>;
	putSecret(secret: SecretDefinition): Promise<void>;
	/**
	 * Update only the description (and updatedAt timestamp) of an existing
	 * secret without touching the encrypted value. Returns false if no secret
	 * with that name exists. Lets API routes implement "edit metadata" flows
	 * without ever needing to decrypt the value.
	 */
	updateSecretDescription(
		name: string,
		description: string | undefined,
	): Promise<boolean>;
	deleteSecret(name: string): Promise<void>;
}

export interface SessionStore {
	getMessages(sessionId: string): Promise<Message[]>;
	append(sessionId: string, messages: Message[]): Promise<void>;
	deleteSession(sessionId: string): Promise<void>;
	listSessions(agentId?: string): Promise<SessionSummary[]>;
	putSessionSnapshot?(snapshot: SessionSnapshot): Promise<void>;
	/**
	 * Ensure a session row exists for `sessionId`. No-op if it does. Used by
	 * the runner so the always-allocated sessionId has a persistent home before
	 * any messages are appended — keeps webhooks/replays able to reference the
	 * session even if the run is cancelled before its first turn completes.
	 */
	getOrCreateSession(sessionId: string): Promise<void>;
}

export interface ContextStore {
	getContext(contextId: string): Promise<ContextEntry[]>;
	addContext(contextId: string, entry: ContextEntry): Promise<void>;
	clearContext(contextId: string): Promise<void>;
}

export interface LogStore {
	log(entry: InvocationLog): Promise<void>;
	getLogs(filter?: LogFilter): Promise<InvocationLog[]>;
	getLog(id: string): Promise<InvocationLog | null>;
}

export interface ProviderConfig {
	/** Provider identifier (e.g., "openai", "anthropic") */
	id: string;
	/** API key */
	apiKey: string;
	/** Optional base URL override (for OpenAI-compatible providers) */
	baseUrl?: string;
	/** Optional provider-specific configuration */
	config?: Record<string, unknown>;
	/** When this config was last updated */
	updatedAt?: string;
}

export interface ProviderStore {
	getProvider(id: string): Promise<ProviderConfig | null>;
	listProviders(): Promise<Array<{ id: string; configured: boolean }>>;
	putProvider(provider: ProviderConfig): Promise<void>;
	deleteProvider(id: string): Promise<void>;
}

// Kinds grow as we add more; `config` is a discriminated union below.
export type ConnectionKind = "mcp";

export interface MCPConnectionConfig {
	url: string;
	headers?: Record<string, string>;
}

export type ConnectionConfig = MCPConnectionConfig;

export interface Connection {
	/** Unique per (userId, kind). For kind="mcp", this is the YAML reference. */
	id: string;
	kind: ConnectionKind;
	displayName: string;
	description?: string;
	config: ConnectionConfig;
	createdAt: string;
	updatedAt: string;
}

export interface ConnectionStore {
	getConnection(kind: ConnectionKind, id: string): Promise<Connection | null>;
	listConnections(kind?: ConnectionKind): Promise<Connection[]>;
	putConnection(connection: Connection): Promise<void>;
	deleteConnection(kind: ConnectionKind, id: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
// Runs — first-class agent invocations, decoupled from any HTTP request
// ═══════════════════════════════════════════════════════════════════════

export type RunStatus =
	| "pending"
	| "running"
	| "draining"
	| "completed"
	| "failed"
	| "cancelled";

/**
 * A single agent invocation managed by a `RunRegistry`. Runs form a tree via
 * `parentId`. Their lifetime is independent of any HTTP request.
 */
export interface Run {
	id: string;
	rootId: string;
	parentId?: string;
	agentId: string;
	/**
	 * ISO timestamp of the agent version that ran. Null/undefined when the
	 * Run executed against an in-memory registered agent (no version history).
	 */
	agentVersion?: string;
	/**
	 * What the caller passed as a version suffix (`"latest"`, an ISO string,
	 * or undefined for bare ids that resolve to the activated version).
	 * Preserved alongside `agentVersion` so traces can show *why* a particular
	 * version ran (`@latest` vs explicit pin vs activated default).
	 */
	requestedAgentVersion?: string;
	userId?: string;
	sessionId?: string;
	retentionMode?: RetentionMode;
	/** ISO timestamp after which a durable record may be removed. */
	expiresAt?: string;
	/** Parent's tool_use_id that spawned this Run (for spawned children). */
	spawnToolUseId?: string;
	status: RunStatus;
	/** Input string the agent was invoked with. */
	input: string;
	result?: InvokeResult;
	error?: string;
	startedAt: number;
	endedAt?: number;
	/** Depth in the Run tree (root = 0). */
	depth: number;
}

/**
 * Filters for RunStore.listRuns. `userId` is implicit (the store is accessed
 * via `store.forUser(userId)`). `cursor` is opaque; backends encode/decode
 * it as base64url JSON `{ startedAt: number, id: string }`.
 */
export interface RunListFilters {
	/** When true (default), only depth=0 runs are returned. */
	rootsOnly?: boolean;
	agentId?: string;
	status?: RunStatus;
	/** ISO 8601. Compared to startedAt converted via Date.parse. */
	startedAfter?: string;
	/** ISO 8601. */
	startedBefore?: string;
	/** Default 50, max 200. */
	limit?: number;
	cursor?: string;
}

export interface RunListResult {
	rows: Run[];
	/** Present iff there is a next page. Pass back as `filters.cursor`. */
	cursor?: string;
}

/**
 * Persistent record of Runs. Optional — RunRegistry works without one
 * (in-memory only). Mirrors the Run interface fields.
 */
export interface RunStore {
	putRun(run: Run): Promise<void>;
	getRun(runId: string): Promise<Run | null>;
	listChildren(parentRunId: string): Promise<Run[]>;
	listSubtree(rootId: string): Promise<Run[]>;
	/**
	 * List runs owned by the scoped user, ordered by `startedAt DESC, id DESC`.
	 * Returns up to `filters.limit` rows (default 50, max 200) plus an opaque
	 * cursor when more pages exist.
	 */
	listRuns(filters: RunListFilters): Promise<RunListResult>;
}

// ═══════════════════════════════════════════════════════════════════════
// Artifacts — owner-scoped metadata for uploaded/generated binary objects
// ═══════════════════════════════════════════════════════════════════════

export type ArtifactPurpose = "input" | "output";
export type ArtifactStatus = "ready" | "deleted" | "failed";

export interface ArtifactMetadata {
	id: string;
	ownerId: string;
	purpose: ArtifactPurpose;
	mediaType: string;
	sizeBytes: number;
	sha256: string;
	createdAt: string;
	expiresAt: string;
	status: ArtifactStatus;
}

export interface ArtifactStore {
	putArtifact(artifact: ArtifactMetadata): Promise<void>;
	getArtifact(artifactId: string): Promise<ArtifactMetadata | null>;
	deleteArtifact(artifactId: string): Promise<void>;
	listExpiredArtifacts(
		before: string,
		limit?: number,
	): Promise<ArtifactMetadata[]>;
}

// ═══════════════════════════════════════════════════════════════════════
// Evals — reusable datasets, rubric definitions, and scored run history
// ═══════════════════════════════════════════════════════════════════════

export type DatasetInput = string | Record<string, unknown> | ContentBlock[];
/** @deprecated Use DatasetInput. */
export type EvalInput = DatasetInput;

export interface EvalCriterionGate {
	minimumScore: number;
}

export interface EvalPassPolicy {
	minimumScore?: number;
}

export interface EvalJudgeConfig {
	model?: ModelConfig;
}

export interface EvalDefaultDatasetRef {
	id: string;
	version?: string;
}

export interface EvalCriterion {
	/** Stable machine key used in judge output and stored results. */
	id: string;
	name: string;
	/** Canonical scoring guidance for this criterion. */
	rubric?: string;
	/** Deprecated alias for rubric. Accepted for compatibility. */
	description?: string;
	/** Defaults to 1. Weighted average uses score * weight / sum(weight). */
	weight?: number;
	/** Optional hard criterion gate. */
	gate?: EvalCriterionGate;
	/** Deprecated alias for gate.minimumScore. */
	threshold?: number;
}

export interface EvalDefinition {
	id: string;
	agentId: string;
	name: string;
	description?: string;
	criteria: EvalCriterion[];
	defaultDataset?: EvalDefaultDatasetRef;
	/** Deprecated alias for defaultDataset.id. */
	defaultDatasetId?: string;
	passPolicy?: EvalPassPolicy;
	/** Deprecated alias for passPolicy.minimumScore. */
	passThreshold?: number;
	judge?: EvalJudgeConfig;
	/** Deprecated alias for judge.model. */
	judgeModel?: ModelConfig;
	metadata?: Record<string, unknown>;
	version?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface DatasetItem {
	id: string;
	name?: string;
	input: DatasetInput;
	metadata?: Record<string, unknown>;
}

export interface Dataset {
	id: string;
	/** Optional legacy eval affinity. Omit for datasets shared by batches/evals. */
	agentId?: string;
	name: string;
	description?: string;
	items: DatasetItem[];
	/** Number of items in the resolved version. Present on summary responses. */
	itemCount?: number;
	metadata?: Record<string, unknown>;
	version?: string;
	createdAt?: string;
	updatedAt?: string;
}

/** @deprecated Use DatasetItem. */
export type EvalDatasetItem = DatasetItem;
/** @deprecated Use Dataset. */
export type EvalDataset = Dataset;

export interface DatasetRef {
	id: string;
	version?: string;
}

export interface DatasetItemListOptions {
	version?: string;
	/** Default 100, max 1,000. */
	limit?: number;
	cursor?: string;
}

export interface DatasetItemListResult {
	rows: DatasetItem[];
	cursor?: string;
}

export interface DatasetImport {
	id: string;
	datasetId: string;
	name: string;
	description?: string;
	agentId?: string;
	metadata?: Record<string, unknown>;
	status: "open" | "completed";
	itemCount: number;
	createdAt: string;
	updatedAt: string;
	datasetVersion?: string;
}

export interface DatasetImportStore {
	createDatasetImport(input: {
		id: string;
		datasetId: string;
		name: string;
		description?: string;
		agentId?: string;
		metadata?: Record<string, unknown>;
	}): Promise<DatasetImport>;
	getDatasetImport(importId: string): Promise<DatasetImport | null>;
	appendDatasetImportItems(
		importId: string,
		items: DatasetItem[],
	): Promise<DatasetImport>;
	completeDatasetImport(importId: string): Promise<Dataset>;
	deleteDatasetImport(importId: string): Promise<void>;
}

export interface EvalCriterionResult {
	score: number;
	passed: boolean;
	reason: string;
	gate?: { minimumScore: number; passed: boolean };
	error?: string;
}

export type EvalCaseStatus = "completed" | "failed" | "skipped" | "cancelled";
export type EvalOutcome = "passed" | "failed" | "score_only";

export interface EvalCaseResult {
	itemId: string;
	status: EvalCaseStatus;
	input: EvalInput;
	output?: string;
	agentRunId?: string;
	invocationId?: string;
	usage?: TokenUsage;
	duration?: number;
	criteria: Record<string, EvalCriterionResult>;
	score: number;
	passed: boolean;
	outcome?: EvalOutcome;
	gateFailures?: string[];
	reason?: string;
	error?: string;
}

export type EvalRunStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface EvalRunSummary {
	totalCases: number;
	completedCases: number;
	failedCases: number;
	skippedCases: number;
	overallScore: number;
	passed: boolean;
	outcome?: EvalOutcome;
	gateFailures?: string[];
	criteria: Record<
		string,
		{
			score: number;
			passed: boolean;
			completedCases: number;
			gate?: { minimumScore: number; passed: boolean };
		}
	>;
}

export interface EvalRunSnapshots {
	eval: EvalDefinition;
	dataset: EvalDataset;
	agent: AgentDefinition;
	evalVersion?: string;
	requestedEvalVersion?: string;
	datasetVersion?: string;
	requestedDatasetVersion?: string;
	agentVersion?: string;
	requestedAgentVersion?: string;
}

export interface EvalRun {
	id: string;
	evalId: string;
	datasetId: string;
	agentId: string;
	evalVersion?: string;
	requestedEvalVersion?: string;
	datasetVersion?: string;
	requestedDatasetVersion?: string;
	agentVersion?: string;
	requestedAgentVersion?: string;
	criterionIds?: string[];
	partial?: boolean;
	status: EvalRunStatus;
	startedAt: string;
	endedAt?: string;
	snapshots: EvalRunSnapshots;
	caseResults: EvalCaseResult[];
	summary?: EvalRunSummary;
	error?: string;
}

export interface EvalListFilters {
	agentId?: string;
}

export interface EvalDatasetListFilters {
	agentId?: string;
}

export interface EvalRunListFilters {
	agentId?: string;
	evalId?: string;
	evalVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	agentVersion?: string;
	status?: EvalRunStatus;
	startedAfter?: string;
	startedBefore?: string;
	/** Default 50, max 200. */
	limit?: number;
	cursor?: string;
}

export interface EvalRunListResult {
	rows: EvalRun[];
	cursor?: string;
}

export interface EvalLatestScoreKey {
	evalId: string;
	evalVersion?: string;
	datasetId: string;
	datasetVersion?: string;
	resolvedAgentVersion?: string;
}

export interface EvalLatestScoreListFilters {
	agentId?: string;
	evalId?: string;
	evalVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	resolvedAgentVersion?: string;
	status?: EvalRunStatus;
}

export interface EvalLatestScore {
	evalId: string;
	evalVersion?: string;
	datasetId: string;
	datasetVersion?: string;
	agentId: string;
	requestedAgentVersion?: string;
	resolvedAgentVersion?: string;
	runId: string;
	status: EvalRunStatus;
	summary?: EvalRunSummary;
	overallScore: number;
	passed: boolean;
	startedAt: string;
	endedAt?: string;
	updatedAt: string;
}

export interface EvalVersionSummary {
	createdAt: string;
	activatedAt?: string | null;
	aliases: string[];
}

export interface EvalDatasetVersionSummary {
	createdAt: string;
	activatedAt?: string | null;
	aliases: string[];
}

export interface EvalStore {
	listEvals(filters?: EvalListFilters): Promise<EvalDefinition[]>;
	getEval(evalId: string): Promise<EvalDefinition | null>;
	putEval(definition: EvalDefinition): Promise<void>;
	deleteEval(evalId: string): Promise<void>;
	listEvalVersions(evalId: string): Promise<EvalVersionSummary[]>;
	getEvalVersion(
		evalId: string,
		createdAt: string,
	): Promise<EvalDefinition | null>;
	activateEvalVersion(evalId: string, createdAt: string): Promise<void>;
	resolveEvalVersionAlias(
		evalId: string,
		alias: string,
	): Promise<string | null>;
	setEvalVersionAlias(
		evalId: string,
		createdAt: string,
		alias: string,
	): Promise<void>;
	removeEvalVersionAlias(evalId: string, alias: string): Promise<void>;
	listDatasets(filters?: EvalDatasetListFilters): Promise<EvalDataset[]>;
	getDataset(datasetId: string): Promise<EvalDataset | null>;
	putDataset(dataset: EvalDataset): Promise<void>;
	deleteDataset(datasetId: string): Promise<void>;
	listDatasetVersions(datasetId: string): Promise<EvalDatasetVersionSummary[]>;
	getDatasetVersion(
		datasetId: string,
		createdAt: string,
	): Promise<EvalDataset | null>;
	activateDatasetVersion(datasetId: string, createdAt: string): Promise<void>;
	resolveDatasetVersionAlias(
		datasetId: string,
		alias: string,
	): Promise<string | null>;
	setDatasetVersionAlias(
		datasetId: string,
		createdAt: string,
		alias: string,
	): Promise<void>;
	removeDatasetVersionAlias(datasetId: string, alias: string): Promise<void>;
	putEvalRun(run: EvalRun): Promise<void>;
	getEvalRun(runId: string): Promise<EvalRun | null>;
	listEvalRuns(filters?: EvalRunListFilters): Promise<EvalRunListResult>;
	getEvalLatestScore(key: EvalLatestScoreKey): Promise<EvalLatestScore | null>;
	listEvalLatestScores(
		filters?: EvalLatestScoreListFilters,
	): Promise<EvalLatestScore[]>;
	putEvalLatestScore(score: EvalLatestScore): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
// Traces — persistent span trees for observability
// ═══════════════════════════════════════════════════════════════════════

export type SpanKind =
	| "run"
	| "manifest"
	| "step"
	| "invoke"
	| "model"
	| "tool";
export type SpanStatus = "running" | "ok" | "error" | "cancelled";

/**
 * One span in a trace tree. Spans form a tree via `parentId` and share a
 * `traceId`. A trace is the set of all spans with the same `traceId`.
 */
export interface Span {
	spanId: string;
	traceId: string;
	parentId: string | null;
	/** Tenant scoping. Same value as `userId` elsewhere in this file; called `ownerId` here because it scopes the trace's owner. */
	ownerId: string;
	runId: string | null;
	sessionId: string | null;
	name: string;
	kind: SpanKind;
	startedAt: string; // ISO 8601
	endedAt: string | null;
	durationMs: number | null;
	status: SpanStatus;
	error: string | null;
	attributes: Record<string, unknown>;
	events: Array<{ ts: string; name: string; data?: unknown }>;
	scores: Record<string, { value: number; reason?: string }>; // reserved for evals; empty in v1
	costUsd: number | null;
}

/**
 * Precomputed roll-up of one trace. Powers list views without scanning all
 * spans. Written/updated by the registry on trace start, span end, and
 * trace end.
 */
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

export interface TraceFilter {
	ownerId: string;
	agentId?: string;
	status?: SpanStatus;
	startedAfter?: string;
	startedBefore?: string;
	limit?: number; // default 50, max 200
	cursor?: string; // opaque; encodes (startedAt, traceId)
}

/**
 * Persistent record of spans and trace summaries. Implementations are
 * owner-scoped — every read filters on `ownerId`, every write tags it.
 */
export interface TraceStore {
	insertSpan(span: Span): Promise<void>;
	insertSpansBatch(spans: Span[]): Promise<void>;
	updateSpan(
		spanId: string,
		ownerId: string,
		patch: Partial<Span>,
	): Promise<void>;
	upsertSummary(summary: TraceSummary): Promise<void>;
	getTrace(traceId: string, ownerId: string): Promise<Span[]>;
	getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null>;
	listTraces(
		filter: TraceFilter,
	): Promise<{ rows: TraceSummary[]; cursor?: string }>;
	deleteTrace(traceId: string, ownerId: string): Promise<void>;
	/** Returns the number of traces (not spans) deleted. */
	deleteOlderThan(ownerId: string, before: Date): Promise<number>;
}

// ═══════════════════════════════════════════════════════════════════════
// Provider-native batches
// ═══════════════════════════════════════════════════════════════════════

export interface BatchDefinition {
	id: string;
	name?: string;
	description?: string;
	/** Raw extended `kind: llm` Agntz YAML. This is the versioned source of truth. */
	manifest: string;
	provider: string;
	model: string;
	defaultDataset?: DatasetRef;
	version?: string;
	createdAt?: string;
	updatedAt?: string;
}

export interface BatchSummary {
	id: string;
	name?: string;
	description?: string;
	provider: string;
	model: string;
	defaultDataset?: DatasetRef;
	version?: string;
	createdAt?: string;
	updatedAt?: string;
}

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

export interface BatchRunSnapshot {
	batch: BatchDefinition;
	dataset?: Omit<Dataset, "items"> & { itemCount: number };
	inlineDataset?: boolean;
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
	snapshot: BatchRunSnapshot;
	callbackUrl?: string;
	webhookSecretName?: string;
	terminalWebhookQueuedAt?: string;
	idempotencyKey?: string;
	createdAt: string;
	submittedAt?: string;
	startedAt?: string;
	endedAt?: string;
	providerExpiresAt?: string;
	nextPollAt?: string;
	lastSyncAt?: string;
	lastSyncError?: string;
	syncAttempts?: number;
	error?: string;
}

export interface BatchRunItem {
	runId: string;
	itemId: string;
	ordinal: number;
	name?: string;
	input: DatasetInput;
	metadata?: Record<string, unknown>;
	status: BatchItemStatus;
	output?: unknown;
	rawOutput?: string;
	error?: string;
	usage?: TokenUsage;
	finishReason?: string;
	providerRequestId?: string;
	durationMs?: number;
}

export interface BatchRunListFilters {
	batchId?: string;
	batchVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	provider?: string;
	model?: string;
	status?: BatchRunStatus;
	startedAfter?: string;
	startedBefore?: string;
	/** Default 50, max 200. */
	limit?: number;
	cursor?: string;
}

export interface BatchRunListResult {
	rows: BatchRun[];
	cursor?: string;
}

export interface BatchRunItemListOptions {
	status?: BatchItemStatus;
	/** Default 100, max 1,000. */
	limit?: number;
	cursor?: string;
}

export interface BatchRunItemListResult {
	rows: BatchRunItem[];
	cursor?: string;
}

export interface BatchRunComparisonRow {
	itemId: string;
	input?: DatasetInput;
	left?: BatchRunItem;
	right?: BatchRunItem;
}

export interface BatchRunComparisonResult {
	leftRun: BatchRun;
	rightRun: BatchRun;
	rows: BatchRunComparisonRow[];
	cursor?: string;
	datasetVersionsMatch: boolean;
}

export interface BatchRunClaim {
	ownerId: string;
	run: BatchRun;
}

export interface BatchStore {
	listBatches(): Promise<BatchSummary[]>;
	getBatch(batchId: string): Promise<BatchDefinition | null>;
	putBatch(definition: BatchDefinition): Promise<void>;
	deleteBatch(batchId: string): Promise<void>;
	listBatchVersions(batchId: string): Promise<BatchVersionSummary[]>;
	getBatchVersion(
		batchId: string,
		createdAt: string,
	): Promise<BatchDefinition | null>;
	activateBatchVersion(batchId: string, createdAt: string): Promise<void>;
	resolveBatchVersionAlias(
		batchId: string,
		alias: string,
	): Promise<string | null>;
	setBatchVersionAlias(
		batchId: string,
		createdAt: string,
		alias: string,
	): Promise<void>;
	removeBatchVersionAlias(batchId: string, alias: string): Promise<void>;

	putBatchRun(run: BatchRun): Promise<void>;
	getBatchRun(runId: string): Promise<BatchRun | null>;
	getBatchRunByIdempotencyKey(key: string): Promise<BatchRun | null>;
	listBatchRuns(filters?: BatchRunListFilters): Promise<BatchRunListResult>;
	deleteBatchRun(runId: string): Promise<void>;
	putBatchRunItems(runId: string, items: BatchRunItem[]): Promise<void>;
	listBatchRunItems(
		runId: string,
		options?: BatchRunItemListOptions,
	): Promise<BatchRunItemListResult>;

	listDatasetItems(
		datasetId: string,
		options?: DatasetItemListOptions,
	): Promise<DatasetItemListResult>;

	/**
	 * Root-store operation used by durable workers. Implementations atomically
	 * lease due, non-terminal runs and return their owner IDs.
	 */
	claimBatchRuns(options: {
		workerId: string;
		now: string;
		leaseUntil: string;
		limit?: number;
	}): Promise<BatchRunClaim[]>;
}

/**
 * Stores that can be scoped to a user. `forUser(userId)` returns a new store
 * instance where every AgentStore/SessionStore/ContextStore/LogStore/
 * ProviderStore method auto-filters by user_id.
 *
 * Calling scoped methods on an unscoped store throws.
 */
export interface ScopableStore {
	forUser(userId: string): UnifiedStore;
	readonly userId: string | null;
}

export type UnifiedStore = AgentStore &
	SessionStore &
	ContextStore &
	LogStore &
	ProviderStore &
	ConnectionStore &
	RunStore &
	ArtifactStore &
	TraceStore &
	SkillStore &
	SecretStore &
	EvalStore &
	DatasetImportStore &
	BatchStore &
	ScopableStore;

// ═══════════════════════════════════════════════════════════════════════
// Model Provider
// ═══════════════════════════════════════════════════════════════════════

export interface ModelProvider {
	generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
	streamText?(options: GenerateTextOptions): Promise<ModelStreamResult>;
}

export interface ModelStreamResult {
	textStream: AsyncIterable<string>;
	toolCalls: Promise<
		Array<{
			id: string;
			name: string;
			args: unknown;
			providerMetadata?: unknown;
		}>
	>;
	usage: Promise<TokenUsage>;
	finishReason: Promise<string>;
	/**
	 * Provider-normalized response messages from the model call. When present,
	 * callers should replay these messages on follow-up turns instead of
	 * reconstructing assistant content from text/tool calls, because providers
	 * may require opaque parts such as reasoning item references.
	 */
	responseMessages?: Promise<Array<{ role: string; content: unknown }>>;
	/** Collect all text + tool calls into a final result */
	toResult(): Promise<GenerateTextResult>;
}

export interface GenerateTextOptions {
	model: ModelConfig;
	/**
	 * Conversation messages. `content` may be a plain string (text-only
	 * messages), a multimodal parts array (`[{type:"text",text},{type:"image",image}]`),
	 * or — for assistant tool calls and tool results — an AI SDK parts array
	 * of `tool-call` / `tool-result` parts. The AI SDK validates the shape
	 * at the call site.
	 */
	messages: Array<{ role: string; content: unknown }>;
	tools?: Array<{
		name: string;
		description: string;
		parameters: Record<string, unknown>;
	}>;
	/** JSON Schema for structured output */
	outputSchema?: {
		name: string;
		schema: Record<string, unknown>;
	};
	/**
	 * Hard cap on tokens generated by one model call. Passed through to the AI
	 * SDK as `maxOutputTokens`. Caps a single completion's size; the cumulative
	 * per-run cap lives on `InvokeOptions.tokenBudget`.
	 */
	maxTokens?: number;
	signal?: AbortSignal;
}

export interface GenerateTextResult {
	text: string;
	/**
	 * Provider-normalized response messages from the model call. When present,
	 * callers should replay these messages on follow-up turns instead of
	 * reconstructing assistant content from text/tool calls, because providers
	 * may require opaque parts such as reasoning item references.
	 */
	responseMessages?: Array<{ role: string; content: unknown }>;
	toolCalls?: Array<{
		id: string;
		name: string;
		args: unknown;
		/**
		 * Opaque, provider-specific metadata attached to this tool call (e.g.
		 * Gemini 3.x `thought_signature`). Some providers require it echoed back
		 * on the next turn via the tool-call part's `providerOptions`; the runner
		 * replays it for that reason. Undefined for providers that don't emit it.
		 */
		providerMetadata?: unknown;
	}>;
	usage: TokenUsage;
	finishReason: string;
	rawFinishReason?: string;
	/** Provider selected by the agent definition. */
	provider?: string;
	/** Model requested by the agent definition. */
	requestedModel?: string;
	/** Actual model id reported by the provider response, when available. */
	model?: string;
	/** Provider response/request id, when available. */
	responseId?: string;
	/** Provider warnings normalized to readable strings. */
	warnings?: string[];
}
