// ═══════════════════════════════════════════════════════════════════════
// Agent Manifest — the YAML-driven agent definition
// ═══════════════════════════════════════════════════════════════════════

import type {
	AgentState,
	ExecutionSpanEmitter,
	HTTPAuth,
	HTTPToolEntry,
} from "@agntz/contracts";

export type AgentKind = "llm" | "tool" | "sequential" | "parallel";

/**
 * Top-level agent manifest. This is what a YAML file parses into.
 */
export type AgentManifest =
	| LLMAgentManifest
	| ToolAgentManifest
	| SequentialAgentManifest
	| ParallelAgentManifest;

/** Fields shared by all agent kinds */
export interface AgentManifestBase {
	id: string;
	name?: string;
	description?: string;
	kind: AgentKind;
	inputSchema?: InputSchema;
	stateKey?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Input / Output Schemas
// ═══════════════════════════════════════════════════════════════════════

/**
 * Flat property map. Each key is a property name.
 * Value is either a type string ("string", "number", "boolean")
 * or an object with constraints ({ type, default, enum, min, max }).
 */
export type InputSchema = Record<string, PropertyDef>;

export type PropertyDef = string | PropertyDefExpanded;

export interface PropertyDefExpanded {
	type: string;
	default?: unknown;
	enum?: unknown[];
	min?: number;
	max?: number;
}

/**
 * Output schema for LLM structured output (same shape as InputSchema).
 */
export type OutputSchema = Record<string, PropertyDef>;

/**
 * Output mapping for pipeline agents.
 * Maps output property names to state template expressions.
 * Supports nested objects for structured output.
 */
export interface OutputMapping {
	[key: string]: string | OutputMapping;
}

// ═══════════════════════════════════════════════════════════════════════
// LLM Agent
// ═══════════════════════════════════════════════════════════════════════

export interface LLMAgentManifest extends AgentManifestBase {
	kind: "llm";
	model: ModelConfig;
	instruction: string;
	/**
	 * Optional user-message template. Rendered with full state via
	 * `renderTemplate` (same as `instruction`). When absent, the user's input
	 * (`state.userQuery`) is sent verbatim as the user message.
	 */
	prompt?: string;
	examples?: Example[];
	tools?: ManifestToolEntry[];
	outputSchema?: OutputSchema;
	/**
	 * Sub-agents this LLM is allowed to spawn concurrently at runtime via the
	 * `spawn_agent` tool. Predefined per agent — the LLM cannot invent agents
	 * to spawn. Each entry is either a ref to a stored agent, or an inline
	 * definition. Mirror of `AgentDefinition.spawnable` in `@agntz/core`.
	 */
	spawnable?: AgentRef[];
	/**
	 * Names of skills this agent may load mid-run via the synthetic
	 * `use_skill` tool. Each name is resolved against the user's SkillStore;
	 * names must match `^[a-z][a-z0-9-]*$`.
	 */
	skills?: string[];
	/**
	 * When set, the runner registers a per-invocation `reply` tool the model
	 * can call to deliver intermediate messages. Mirrors
	 * `AgentDefinition.reply` in `@agntz/core`. Pass `true` for defaults or
	 * an object to override `maxPerRun`.
	 */
	reply?: boolean | { maxPerRun?: number };
	/**
	 * Resource declarations this agent may use. Runtime providers interpret
	 * config; the manifest layer only validates generic shape.
	 */
	resources?: Record<string, ResourceManifestEntry>;
}

/**
 * Reference to an agent the parent is allowed to spawn. Mirrors
 * `AgentRef` in `@agntz/core` so manifest YAML and `AgentDefinition`
 * round-trip 1:1. `version` is `"latest"`, an ISO 8601 timestamp, or
 * undefined (use the activated version).
 */
export type AgentRef =
	| { kind: "ref"; agentId: string; version?: string }
	| { kind: "inline"; definition: LLMAgentManifest };

export interface ModelConfig {
	provider: string;
	name: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
}

export type ResourceMode = "read" | "read-write";

export interface ResourceManifestEntry {
	/** Provider kind. Defaults to the resource map key when omitted. */
	kind: string;
	/** Per-agent access mode. Providers may define kind-specific defaults. */
	mode?: ResourceMode;
	/** Optional static provider input, not an automatic runtime grant. */
	namespace?: string | string[];
	/** Provider-specific config passthrough. */
	config?: unknown;
	/** Additional provider-specific fields. */
	[key: string]: unknown;
}

export interface Example {
	input: string;
	output: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Tool Agent
// ═══════════════════════════════════════════════════════════════════════

export interface ToolAgentManifest extends AgentManifestBase {
	kind: "tool";
	tool: ToolCallConfig;
}

export interface ToolCallConfig {
	kind: "mcp" | "local" | "http";
	name: string;
	params?: Record<string, string>;
	/** mcp only — server id or URL */
	server?: string;
	/** http only — endpoint URL; may contain `{X}` / `{X?}` placeholders */
	url?: string;
	/** http only — GET/POST/PUT/PATCH/DELETE */
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	/** http only — optional description shown to operators */
	description?: string;
	/** http only — header values are state-templated; supports `{{secrets.X}}` */
	headers?: Record<string, string>;
	/** http only — body encoding when `body` is set */
	body_type?: "json" | "form" | "query";
	/** http only — request body (state-templated) */
	body?: unknown;
	/** http only — dynamic auth (oauth2_client_credentials | token_exchange) */
	auth?: HTTPAuth;
}

// ═══════════════════════════════════════════════════════════════════════
// Sequential Agent
// ═══════════════════════════════════════════════════════════════════════

export interface SequentialAgentManifest extends AgentManifestBase {
	kind: "sequential";
	steps: StepRef[];
	until?: string;
	maxIterations?: number;
	output?: OutputMapping;
}

// ═══════════════════════════════════════════════════════════════════════
// Parallel Agent
// ═══════════════════════════════════════════════════════════════════════

export interface ParallelAgentManifest extends AgentManifestBase {
	kind: "parallel";
	branches: StepRef[];
	output?: OutputMapping;
}

// ═══════════════════════════════════════════════════════════════════════
// Step Reference (used in sequential steps and parallel branches)
// ═══════════════════════════════════════════════════════════════════════

export interface StepRef {
	/** Reference to an existing agent by ID */
	ref?: string;
	/** Inline agent definition */
	agent?: AgentManifest;
	/** State-to-input transform */
	input?: Record<string, string>;
	/** Override output key on parent state */
	stateKey?: string;
	/** Conditional execution */
	when?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// Tool Configuration (in LLM agent tools array)
// ═══════════════════════════════════════════════════════════════════════

export type ManifestToolEntry =
	| MCPToolEntry
	| LocalToolEntry
	| AgentToolEntry
	| HTTPToolEntry;

export interface MCPToolEntry {
	kind: "mcp";
	/** Registered connection id OR raw URL. Resolver tries registry first. */
	server: string;
	tools?: MCPToolRef[];
	/**
	 * Optional headers sent on every MCP request. Values may reference secrets
	 * via `{{secrets.<NAME>}}` and are substituted at runtime. Only meaningful
	 * when `server` is a raw URL — registered connections supply their own
	 * headers from the connection store.
	 */
	headers?: Record<string, string>;
}

/** An item in the tools array: either a plain tool name or a wrapped tool */
export type MCPToolRef = string | WrappedToolRef;

export interface WrappedToolRef {
	tool: string;
	name?: string;
	description?: string;
	params?: Record<string, string>;
}

export interface LocalToolEntry {
	kind: "local";
	tools: string[];
}

export interface AgentToolEntry {
	kind: "agent";
	/**
	 * Agent reference. May be a bare id (`"reviewer"`), an `@version`-suffixed
	 * ref (`"reviewer@latest"`, `"reviewer@2026-05-17T15:30:00.000Z"`), OR a
	 * bare id paired with the structured `version` field below. Manifests must
	 * not specify both an `@`-suffix and `version`.
	 */
	agent: string;
	/** Optional structured version (`"latest"` or ISO 8601 timestamp). */
	version?: string;
}

// `HTTPToolEntry` and the declarative HTTP auth config (`HTTPAuth`,
// `TokenExchangeAuth`, …) are shared vocabulary defined in `@agntz/contracts`.
export type { HTTPToolEntry };

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

/** Runtime state for an agent execution. Shared vocabulary in `@agntz/contracts`. */
export type { AgentState };

// ═══════════════════════════════════════════════════════════════════════
// Execution
// ═══════════════════════════════════════════════════════════════════════

export interface ExecutionContext {
	/** Resolve an agent ID to its manifest */
	resolveAgent: (id: string) => Promise<AgentManifest>;
	/**
	 * Execute an LLM agent via the core runner.
	 * `renderedInstruction` becomes the system prompt. `renderedPrompt`, when
	 * provided, is used as the user message; otherwise the bridge derives the
	 * user message from `state.userQuery`.
	 */
	invokeLLM: (
		manifest: LLMAgentManifest,
		renderedInstruction: string,
		renderedPrompt: string | undefined,
		state: AgentState,
	) => Promise<unknown>;
	/** Execute a tool call */
	invokeTool: (config: ToolCallConfig, state: AgentState) => Promise<unknown>;

	/** Per-request span emitter — used by executor and pipelines to wrap manifest
	 *  and step lifecycles with spans. Null/undefined disables emission.
	 *  Core's concrete `SpanEmitter` satisfies this structurally. */
	spanEmitter?: ExecutionSpanEmitter;

	/** Tenant scoping. Threaded from the worker request through to spans. */
	ownerId?: string;
}

export interface ExecutionResult {
	output: unknown;
	state: AgentState;
}
