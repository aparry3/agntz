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
  examples?: Example[];
  tools?: ManifestToolEntry[];
  outputSchema?: OutputSchema;
}

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
  kind: "mcp" | "local";
  server?: string;
  name: string;
  params?: Record<string, string>;
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
  | AgentToolEntry;

export interface MCPToolEntry {
  kind: "mcp";
  server: string;
  tools?: MCPToolRef[];
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
  /** Execute an LLM agent via the core runner */
  invokeLLM: (manifest: LLMAgentManifest, input: string, state: AgentState) => Promise<unknown>;
  /** Execute a tool call */
  invokeTool: (config: ToolCallConfig, state: AgentState) => Promise<unknown>;
}

export interface ExecutionResult {
  output: unknown;
  state: AgentState;
}
