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
}

/**
 * Reference to an agent the parent is allowed to spawn. Mirrors
 * `AgentRef` in `@agntz/core` so manifest YAML and `AgentDefinition`
 * round-trip 1:1.
 */
export type AgentRef =
  | { kind: "ref"; agentId: string }
  | { kind: "inline"; definition: LLMAgentManifest };

export interface ModelConfig {
  provider: string;
  name: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
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
  /** http only — MVP supports GET; typed permissive for future verbs */
  method?: "GET";
  /** http only — optional description shown to operators */
  description?: string;
  /** http only — header values are state-templated; supports `{{secrets.X}}` */
  headers?: Record<string, string>;
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
  agent: string;
}

/**
 * HTTP tool entry — one GET endpoint exposed to the model as one tool.
 * URL placeholders ({X}, {X?}) derive the LLM-facing schema. Any keys in
 * `params:` pin those placeholders to state-resolved templates (mirrors the
 * MCP WrappedToolRef convention). `headers:` values are also templated.
 * Auth tokens are referenced via `{{secrets.<name>}}`.
 *
 * MVP: only GET. The `method` field is typed permissively for future verbs
 * (POST/PUT/DELETE) but validators reject anything other than "GET".
 */
export interface HTTPToolEntry {
  kind: "http";
  /** Becomes `http__<name>` for the model. Must be a programming identifier. */
  name: string;
  /** Endpoint URL. May contain `{X}` (required) or `{X?}` (optional) placeholders. */
  url: string;
  /** Only "GET" supported in MVP; type kept permissive for future extension. */
  method?: "GET";
  description?: string;
  /** Pinned placeholders (state templates). Mirrors `WrappedToolRef.params`. */
  params?: Record<string, string>;
  /** HTTP headers. Values are state-templated and may reference `{{secrets.X}}`. */
  headers?: Record<string, string>;
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
