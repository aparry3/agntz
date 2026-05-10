import type { ZodSchema } from "zod";
import type { TelemetryConfig } from "./telemetry.js";

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
  /** Model name: "gpt-5.4", "claude-sonnet-4-6", etc. */
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

/**
 * Reference to an agent that can be spawned as a child Run.
 * Either by ID into the AgentStore, or inline-defined at runtime.
 */
export type AgentRef =
  | { kind: "ref"; agentId: string }
  | { kind: "inline"; definition: AgentDefinition };

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
  /** ID of the Run executing this tool, if running under a RunRegistry */
  runId?: string;
  /** The owning user (set when the runner store is user-scoped) */
  userId?: string;
  /**
   * Run registry, when the runner is wired to one. The `spawn_agent` tool
   * uses this to create child Runs without blocking the current loop.
   */
  runRegistry?: RunRegistry;
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

  /** OpenTelemetry configuration (opt-in) */
  telemetry?: TelemetryConfig;
}

export interface MCPServerConfig {
  /** HTTP URL for the MCP server (Streamable HTTP / SSE) */
  url: string;
  /** Optional headers for HTTP requests */
  headers?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════════════
// Store Interfaces
// ═══════════════════════════════════════════════════════════════════════

export interface AgentVersionSummary {
  createdAt: string;
  activatedAt: string | null;
}

export interface AgentStore {
  getAgent(id: string): Promise<AgentDefinition | null>;
  listAgents(): Promise<Array<{ id: string; name: string; description?: string }>>;
  putAgent(agent: AgentDefinition): Promise<void>;
  deleteAgent(id: string): Promise<void>;

  /** List all stored versions of an agent, most recent first. */
  listAgentVersions(agentId: string): Promise<AgentVersionSummary[]>;
  /** Fetch a specific version by its created_at timestamp. */
  getAgentVersion(agentId: string, createdAt: string): Promise<AgentDefinition | null>;
  /** Mark a specific version as the active one. */
  activateAgentVersion(agentId: string, createdAt: string): Promise<void>;
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
  userId?: string;
  sessionId?: string;
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
  | { type: "run-spawn"; runId: string; parentId?: string; agentId: string; seq: number }
  | { type: "text-delta"; runId: string; text: string; seq: number }
  | { type: "tool-call-start"; runId: string; toolCall: { id: string; name: string }; seq: number }
  | { type: "tool-call-end"; runId: string; toolCall: ToolCallRecord; seq: number }
  | { type: "step-complete"; runId: string; step: number; toolCalls: ToolCallRecord[]; seq: number }
  | { type: "draining"; runId: string; pendingChildren: string[]; seq: number }
  | { type: "run-complete"; runId: string; result: InvokeResult; seq: number }
  | { type: "run-error"; runId: string; error: string; seq: number }
  | { type: "run-cancelled"; runId: string; seq: number };

export interface SpawnRunOptions {
  agentId: string;
  input: string;
  parentRunId?: string;
  spawnToolUseId?: string;
  userId?: string;
  sessionId?: string;
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
  /** Optional persistence layer. */
  readonly store?: RunStore;
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
}

// ═══════════════════════════════════════════════════════════════════════
// Multi-tenancy: per-user scoping + API keys
// ═══════════════════════════════════════════════════════════════════════

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * API key management. `createApiKey`/`listApiKeys`/`revokeApiKey` require an
 * explicit userId (they're admin-style calls, not scoped reads).
 * `resolveApiKey` is the worker's inbound auth path — given a raw key, return
 * the user it belongs to.
 */
export interface ApiKeyStore {
  createApiKey(params: { userId: string; name: string }): Promise<{ record: ApiKeyRecord; rawKey: string }>;
  listApiKeys(userId: string): Promise<ApiKeyRecord[]>;
  revokeApiKey(params: { userId: string; keyId: string }): Promise<void>;
  resolveApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null>;
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
  ApiKeyStore &
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
