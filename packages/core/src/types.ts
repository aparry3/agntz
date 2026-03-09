import type { ZodSchema } from "zod";

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

  /** Structured output constraint (JSON Schema) */
  outputSchema?: Record<string, unknown>;

  /** If true, output auto-writes to context */
  contextWrite?: boolean;

  /** Evaluation configuration */
  eval?: EvalConfig;

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
  /** Model name: "gpt-4o", "claude-sonnet-4-20250514", etc. */
  name: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  options?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Tool System
// ═══════════════════════════════════════════════════════════════════════

export type ToolReference =
  | { type: "inline"; name: string }
  | { type: "mcp"; server: string; tools?: string[] }
  | { type: "agent"; agentId: string };

export interface ToolDefinition<TInput = unknown, TCtx extends Record<string, unknown> = Record<string, unknown>> {
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
  /** Active context bucket IDs */
  contextIds?: string[];
  /** Unique ID for the current invocation */
  invocationId: string;
  /** Invoke another agent */
  invoke(agentId: string, input: string, options?: InvokeOptions): Promise<InvokeResult>;
  /** Spread toolContext values */
  [key: string]: unknown;
}

export interface ToolInfo {
  name: string;
  description: string;
  source: "inline" | `mcp:${string}`;
  inputSchema: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════
// Invocation
// ═══════════════════════════════════════════════════════════════════════

export interface InvokeOptions {
  /** Enables conversational continuity */
  sessionId?: string;
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
  /** Maximum tool call loop iterations (default: 10) */
  maxSteps?: number;
  /** @internal Recursion depth tracker for agent-as-tool chains */
  _recursionDepth?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Streaming
// ═══════════════════════════════════════════════════════════════════════

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call-start"; toolCall: { id: string; name: string } }
  | { type: "tool-call-end"; toolCall: ToolCallRecord }
  | { type: "step-complete"; step: number; toolCalls: ToolCallRecord[] }
  | { type: "done"; result: InvokeResult };

export interface InvokeStream extends AsyncIterable<StreamEvent> {
  /** Await the final result (consumes the stream) */
  result: Promise<InvokeResult>;
}

export interface InvokeResult {
  /** The agent's final text response */
  output: string;
  /** Unique ID for this invocation */
  invocationId: string;
  /** All tool calls made during execution */
  toolCalls: ToolCallRecord[];
  /** Token usage */
  usage: TokenUsage;
  /** Milliseconds */
  duration: number;
  /** Model used */
  model: string;
}

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
}

// ═══════════════════════════════════════════════════════════════════════
// Messages & Sessions
// ═══════════════════════════════════════════════════════════════════════

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
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
  input: string;
  output: string;
  toolCalls: ToolCallRecord[];
  usage: TokenUsage;
  duration: number;
  model: string;
  error?: string;
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
// Evaluation
// ═══════════════════════════════════════════════════════════════════════

export interface EvalConfig {
  rubric?: string;
  evalModel?: string;
  testCases?: EvalTestCase[];
  autoEval?: boolean;
  passThreshold?: number;
}

export interface EvalTestCase {
  name?: string;
  input: string;
  expectedOutput?: string;
  assertions?: EvalAssertion[];
  context?: string;
}

export interface EvalAssertion {
  type: "contains" | "not-contains" | "regex" | "json-schema" | "llm-rubric" | "semantic-similar" | "custom";
  value: string | object;
  weight?: number;
}

export interface EvalResult {
  agentId: string;
  timestamp: string;
  duration: number;
  testCases: Array<{
    name: string;
    input: string;
    output: string;
    assertions: Array<{
      type: string;
      passed: boolean;
      score?: number;
      reason?: string;
    }>;
    passed: boolean;
    score: number;
  }>;
  summary: {
    total: number;
    passed: number;
    failed: number;
    score: number;
  };
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
}

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════
// Store Interfaces
// ═══════════════════════════════════════════════════════════════════════

export interface AgentStore {
  getAgent(id: string): Promise<AgentDefinition | null>;
  listAgents(): Promise<Array<{ id: string; name: string; description?: string }>>;
  putAgent(agent: AgentDefinition): Promise<void>;
  deleteAgent(id: string): Promise<void>;
}

export interface SessionStore {
  getMessages(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(agentId?: string): Promise<SessionSummary[]>;
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

export type UnifiedStore = AgentStore & SessionStore & ContextStore & LogStore;

// ═══════════════════════════════════════════════════════════════════════
// Model Provider
// ═══════════════════════════════════════════════════════════════════════

export interface ModelProvider {
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
  streamText?(options: GenerateTextOptions): Promise<ModelStreamResult>;
}

export interface ModelStreamResult {
  textStream: AsyncIterable<string>;
  toolCalls: Promise<Array<{ id: string; name: string; args: unknown }>>;
  usage: Promise<TokenUsage>;
  finishReason: Promise<string>;
  /** Collect all text + tool calls into a final result */
  toResult(): Promise<GenerateTextResult>;
}

export interface GenerateTextOptions {
  model: ModelConfig;
  messages: Array<{ role: string; content: string }>;
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
  signal?: AbortSignal;
}

export interface GenerateTextResult {
  text: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: unknown;
  }>;
  usage: TokenUsage;
  finishReason: string;
}
