// ═══════════════════════════════════════════════════════════════════════
// agntz — TypeScript SDK for AI Agents
// ═══════════════════════════════════════════════════════════════════════

// Core API
export { createRunner, Runner } from "./runner.js";
export { defineAgent } from "./agent.js";
export { defineSkill } from "./skill.js";
export { defineTool, ToolRegistry } from "./tool.js";
export { InMemoryRunRegistry } from "./run-registry.js";
export type {
	RunExecutor,
	InMemoryRunRegistryOptions,
} from "./run-registry.js";
export {
	createEvalJudgeAgent,
	criterionGateMinimum,
	criterionRubric,
	evalJudgeModel,
	evalPassPolicyMinimum,
	latestScoreFromEvalRun,
	listEvalRunsInProcess,
	normalizeCriterionWeight,
	normalizePassThreshold,
	parseJudgeOutputText,
	runEval,
	scoreCriterionJudgeOutput,
	scoreJudgeEnvelope,
	summarizeEvalRun,
} from "./evals.js";
export type { RunEvalOptions, JudgeEnvelope } from "./evals.js";
export {
	createSpawnAgentTool,
	createCheckAgentsTool,
	resolveSpawnable,
	DEFAULT_SPAWN_LIMITS,
} from "./tools/spawn-agent.js";
export type { SpawnLimits, SpawnableEntry } from "./tools/spawn-agent.js";
export { createUseSkillTool } from "./tools/use-skill.js";
export { createReplyTool } from "./tools/reply.js";
export type { ReplyToolDeps } from "./tools/reply.js";
export { DEFAULT_REPLY_MAX_PER_RUN } from "./types.js";
export { buildHttpToolDefinition } from "./http-tool.js";
export type {
	HTTPToolEntry as HTTPToolEntryRuntime,
	AgentState as RuntimeState,
} from "./http-tool.js";
export {
	AuthError,
	MapTokenCache,
	createTokenResolver,
} from "./auth/index.js";
export type {
	AppliedAuth,
	HTTPAuth,
	OAuth2ClientCredentialsAuth,
	ResolveAuthCtx,
	TokenCache,
	TokenCacheEntry,
	TokenExchangeApply,
	TokenExchangeAuth,
	TokenExchangeExtract,
	TokenExchangeRequest,
	TokenResolver,
	TokenResolverDeps,
} from "./auth/index.js";

// Stores
export { MemoryStore, createMemoryBackend } from "./stores/memory.js";
export type { MemoryBackend } from "./stores/memory.js";

// ID utilities — exposed so workers/SDKs can pre-allocate session/run ids
// before invoking the runner (e.g. to include them in immediate responses).
export {
	generateId,
	generateInvocationId,
	generateRunId,
	generateSessionId,
} from "./utils/id.js";

// Model Provider
export { AISDKModelProvider } from "./model-provider.js";

// MCP
export { MCPClientManager } from "./mcp/client-manager.js";
export type { MCPClientManagerOptions, MCPTool } from "./mcp/client-manager.js";
export { createMCPServer } from "./mcp/server.js";
export type { MCPServerOptions } from "./mcp/server.js";
export { listToolsOnServer } from "./mcp/list-tools.js";
export type { ListToolsOptions } from "./mcp/list-tools.js";
export { resolveMCPServer } from "./mcp/resolve-server.js";
export type { ResolvedMCPServer } from "./mcp/resolve-server.js";

// Pricing
export { computeCost } from "./model-pricing.js";
export type { ModelRate } from "./model-pricing.js";

// Telemetry
export { SpanEmitter, Telemetry } from "./telemetry.js";
export type {
	TelemetryConfig,
	OTelTracer,
	OTelSpan,
	RunSpan,
	ManifestSpan,
	StepSpan,
	InvokeSpan,
	ModelCallSpan,
	ToolCallSpan,
} from "./telemetry.js";
export type { TraceSink } from "./types.js";

// Utilities
export { withRetry } from "./utils/retry.js";
export type { RetryConfig } from "./utils/retry.js";
export {
	summarizeMessages,
	trimHistoryWithSummary,
} from "./utils/summarize.js";
export {
	OutboundUrlPolicyError,
	assertOutboundUrlAllowed,
	fetchWithOutboundPolicy,
	validateOutboundUrl,
} from "./utils/outbound-url.js";
export type {
	FetchWithOutboundPolicyOptions,
	OutboundUrlPolicyOptions,
} from "./utils/outbound-url.js";
export {
	encryptSecret,
	decryptSecret,
	getLastFour,
	_resetCryptoKeyCache,
} from "./utils/crypto.js";
export {
	normalizeNamespaceGrant,
	normalizeNamespaceGrants,
	namespaceAncestors,
	isSameOrAncestorNamespace,
	isSameOrDescendantNamespace,
	isGrantNarrowedBy,
	narrowNamespaceGrants,
	validateNamespaceGrantPolicy,
} from "./namespace.js";
export type {
	NamespaceGrant,
	NamespaceGrantPolicy,
	ProtectedNamespaceRule,
} from "./namespace.js";
export { makeResourceToolName, resourceToolPrefix } from "./resource.js";

// Errors
export {
	AgntzError,
	AgentNotFoundError,
	AgentVersionNotFoundError,
	InvalidAgentRefError,
	NamespaceGrantError,
	ToolNotFoundError,
	ToolExecutionError,
	ModelError,
	ProviderNotFoundError,
	InvocationCancelledError,
	InvocationTimeoutError,
	MaxStepsExceededError,
	TokenBudgetExceededError,
	MaxRecursionDepthError,
	RetryExhaustedError,
	ValidationError,
	SkillNotFoundError,
} from "./errors.js";

// Agent references — `<id>[@<version|latest|alias>]`
export {
	parseAgentRef,
	formatAgentRef,
	isIsoTimestamp,
	isAliasName,
} from "./agent-ref.js";
export type { ParsedAgentRef } from "./agent-ref.js";

// Manifest → AgentDefinition bridge. The canonical lowering shared by every
// host (embedded SDK + hosted worker); see `./manifest-to-agent.ts`.
export { manifestToAgentDefinition } from "./manifest-to-agent.js";
export type { ManifestToAgentOptions } from "./manifest-to-agent.js";

// Multimodal — image content blocks + fetcher
export { isContentBlockArray } from "./types.js";
export { normalizeImageBlocks, ImageFetchError } from "./image-fetcher.js";
export type { NormalizeImageBlocksOptions } from "./image-fetcher.js";

// Sentinel prefix used by SQL stores to encode a ContentBlock[]
// `InvocationLog.input` inside the legacy `input TEXT` column without a
// second column. Now lives in `@agntz/contracts` (the SQL store adapters use
// it); re-exported here so core's public surface is unchanged.
export { INVOCATION_LOG_BLOCKS_PREFIX } from "@agntz/contracts";

// Types
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
	ToolDefinition,
	ToolReference,
	ToolContext,
	ToolInfo,
	// Invocation
	InvokeOptions,
	InvokeResult,
	InvokeStream,
	StreamEvent,
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
	// Configuration
	RunnerConfig,
	MCPServerConfig,
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
	RunHandle,
	RunStore,
	RunRegistry,
	PendingChildResult,
	MultiplexedEvent,
	SpawnRunOptions,
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
	TraceLiveEvent,
	TraceStore,
	// Model Provider
	ModelProvider,
	ModelStreamResult,
	GenerateTextOptions,
	GenerateTextResult,
} from "./types.js";
