// ═══════════════════════════════════════════════════════════════════════
// Agent Manifest — the YAML-driven agent definition
// ═══════════════════════════════════════════════════════════════════════

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

/**
 * HTTP tool entry — one endpoint exposed to the model as one tool.
 * URL placeholders ({X}, {X?}) derive the LLM-facing schema. Any keys in
 * `params:` pin those placeholders to state-resolved templates (mirrors the
 * MCP WrappedToolRef convention). `headers:`, `body:`, and `params:` values
 * are all state-templated.
 *
 * Static credentials are referenced via templated headers + `{{secrets.X}}`.
 * Dynamic credentials (OAuth2, custom token exchange) are handled via the
 * `auth` block, which the runner resolves before each request (with cache +
 * refresh-on-401).
 */
export interface HTTPToolEntry {
	kind: "http";
	/** Becomes `http__<name>` for the model. Must be a programming identifier. */
	name: string;
	/** Endpoint URL. May contain `{X}` (required) or `{X?}` (optional) placeholders. */
	url: string;
	/** HTTP method. Default `GET`. */
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	description?: string;
	/** Pinned placeholders (state templates). Mirrors `WrappedToolRef.params`. */
	params?: Record<string, string>;
	/** HTTP headers. Values are state-templated and may reference `{{secrets.X}}`. */
	headers?: Record<string, string>;
	/**
	 * How to encode `body` on the wire. Only meaningful for methods that
	 * accept a body. Defaults to `json` when `body` is present.
	 */
	body_type?: "json" | "form" | "query";
	/**
	 * Request body. Templated values are interpolated from state at execute
	 * time (same semantics as `headers`/`params`). For `body_type: json` the
	 * shape is preserved; for `form`/`query` it must be a flat string map.
	 */
	body?: unknown;
	/**
	 * Dynamic authentication. When set, the runner fetches/caches a token
	 * before each request and applies it to the outgoing call. Static
	 * credentials (Bearer/Basic/API key) can continue using `headers` with
	 * `{{secrets.<name>}}` — `auth` is only needed for token-exchange flows.
	 */
	auth?: HTTPAuth;
}

// ─── HTTP authentication ──────────────────────────────────────────────
/**
 * Dynamic auth for HTTP tools. Discriminated by `type`.
 *
 *  - `oauth2_client_credentials`: RFC 6749 §4.4 preset for the standard
 *    client-credentials grant. Sends `grant_type=client_credentials` to a
 *    token endpoint and uses the returned `access_token`.
 *  - `token_exchange`: fully parametric. Configure the token request shape,
 *    response parsing, and how the token applies to the real request.
 */
export type HTTPAuth = OAuth2ClientCredentialsAuth | TokenExchangeAuth;

/**
 * Standard OAuth2 client-credentials grant (RFC 6749 §4.4). A preset over
 * `token_exchange` with the spec-defined request/response shape baked in.
 */
export interface OAuth2ClientCredentialsAuth {
	type: "oauth2_client_credentials";
	/** Token endpoint URL. */
	token_url: string;
	/** OAuth2 client id. Templated; typically `"{{secrets.X}}"`. */
	client_id: string;
	/** OAuth2 client secret. Templated; typically `"{{secrets.X}}"`. */
	client_secret: string;
	/** Optional space-delimited scope list. */
	scope?: string;
	/**
	 * Where to put client credentials in the token request. `basic_header`
	 * (RFC default) sends them in `Authorization: Basic base64(id:secret)`;
	 * `body` sends them as form fields alongside `grant_type`. Default:
	 * `basic_header`.
	 */
	creds_location?: "basic_header" | "body";
	/**
	 * Cache TTL override in seconds. Falls back to the token endpoint's
	 * `expires_in` if provided, otherwise 3000 (50 minutes).
	 */
	cache_ttl?: number;
	/**
	 * HTTP status codes that trigger a token invalidate + retry. Default
	 * `[401]`. Retry budget is hard-capped at 1 per call.
	 */
	refresh_on?: number[];
}

/**
 * Fully parametric token-exchange auth. Covers OAuth2 variants and
 * homegrown login endpoints that don't match the spec.
 */
export interface TokenExchangeAuth {
	type: "token_exchange";
	/** How to fetch the token. */
	request: TokenExchangeRequest;
	/** How to extract the token from the response. */
	extract: TokenExchangeExtract;
	/** How to apply the token to the real request. */
	apply: TokenExchangeApply;
	/**
	 * Cache TTL override in seconds. Falls back to `extract.expires_path`
	 * if set, otherwise 3000 (50 minutes).
	 */
	cache_ttl?: number;
	/**
	 * HTTP status codes that trigger a token invalidate + retry. Default
	 * `[401]`. Retry budget is hard-capped at 1 per call.
	 */
	refresh_on?: number[];
}

export interface TokenExchangeRequest {
	url: string;
	method?: "GET" | "POST" | "PUT" | "PATCH";
	/** Headers to send on the token request. State-templated. */
	headers?: Record<string, string>;
	/** Body encoding. Defaults to `json` when `body` is present. */
	body_type?: "json" | "form" | "query";
	/** Body for the token request. State-templated. */
	body?: unknown;
}

export interface TokenExchangeExtract {
	/**
	 * How to parse the response. `json` (default) parses then JSONPath-extracts;
	 * `text` treats the whole body as the token string and ignores `token_path`.
	 * When omitted, parsing is inferred from the `Content-Type` header.
	 */
	response_format?: "json" | "text";
	/**
	 * JSONPath to the token inside a JSON response. Must start with `$`.
	 * Ignored when `response_format: text`. Required otherwise.
	 */
	token_path?: string;
	/**
	 * Optional JSONPath to the token TTL in seconds (e.g. OAuth2 `expires_in`).
	 * Falls back to `cache_ttl`, then the 3000s default.
	 */
	expires_path?: string;
}

export interface TokenExchangeApply {
	/** Where to put the token on the real request. Default `header`. */
	location?: "header" | "query";
	/**
	 * Header or query parameter name. Default `Authorization` for `header`;
	 * required for `query`.
	 */
	name?: string;
	/**
	 * Template applied to the token before placing it. Must contain `{token}`.
	 * Default `"Bearer {token}"` for `header`; `"{token}"` for `query`.
	 */
	format?: string;
}

// ═══════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════

/**
 * Runtime state for an agent execution.
 * Shape: { ...input, [stateKey]: subAgentOutput, ... }
 */
export type AgentState = Record<string, unknown>;

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
	 *  and step lifecycles with spans. Null/undefined disables emission. */
	spanEmitter?: import("@agntz/core").SpanEmitter;

	/** Tenant scoping. Threaded from the worker request through to spans. */
	ownerId?: string;
}

export interface ExecutionResult {
	output: unknown;
	state: AgentState;
}
