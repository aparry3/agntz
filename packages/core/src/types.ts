import type { ZodSchema } from "zod";
import type { TelemetryConfig } from "./telemetry.js";
import type { SpanEmitter } from "./telemetry.js";
import type { HTTPToolEntry } from "./http-tool.js";

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

  /** Evaluation configuration */
  eval?: EvalConfig;

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
  | { type: "mcp"; server: string; tools?: string[]; headers?: Record<string, string> }
  | { type: "agent"; agentId: string }
  | { type: "http"; entry: HTTPToolEntry };

/**
 * Reference to an agent that can be spawned as a child Run.
 * Either by ID into the AgentStore (optionally pinned to `@latest` or a
 * specific ISO timestamp), or inline-defined at runtime.
 */
export type AgentRef =
  | { kind: "ref"; agentId: string; version?: string }
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
  /** Skills already loaded in this run (use_skill tool reads/writes this). */
  loadedSkills?: Set<string>;
  /** SkillStore used by the use_skill tool to fetch definitions on demand. */
  skillStore?: SkillStore;
  /**
   * Callback the use_skill tool invokes to wire a loaded skill's tools into
   * the live tool registry and report descriptors back to the model. The
   * runner supplies this in the per-call ToolContext.
   */
  registerSkillTools?: (
    refs: ToolReference[],
  ) => Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>>;
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
  spanEmitter?: import("./telemetry.js").SpanEmitter;
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
  | { type: "reply"; text: string; ts: string; sessionId: string; runId: string }
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
    }
  | { type: "image"; base64: string; mediaType: ImageMediaType };

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
      if (!hasUrl && !hasBase64) return false;
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
  tokenCache?: import("./auth/index.js").TokenCache;

  /**
   * Server-side outbound URL policy for user-controlled HTTP, MCP, image,
   * token exchange, and webhook fetches. Defaults block localhost/private
   * networks and DNS answers that resolve to them.
   */
  outboundUrlPolicy?: import("./utils/outbound-url.js").OutboundUrlPolicyOptions;
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
  /** Human-readable aliases pointing at this version (`stable`, `prod`, …). */
  aliases: string[];
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
  setAgentVersionAlias(agentId: string, createdAt: string, alias: string): Promise<void>;
  /** Drop an alias from any version it currently points at. No-op if absent. */
  removeAgentVersionAlias(agentId: string, alias: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════
// Skills — reusable (instruction + tools) bundles an LLM agent can opt into
// mid-run. See packages/core/src/tools/use-skill.ts for the synthetic tool
// the runner registers when an agent declares skills.
// ═══════════════════════════════════════════════════════════════════════

export interface SkillDefinition {
  /** lowercase-kebab-case; unique per user; identifier */
  name: string;
  /** Surfaced to the LLM via the system prompt's "Available skills" section. */
  description: string;
  /** Returned as the use_skill tool result when the LLM loads the skill. */
  instructions: string;
  /** Tools registered into the live tool registry when the skill is loaded. */
  tools?: ToolReference[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

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
  updateSecretDescription(name: string, description: string | undefined): Promise<boolean>;
  deleteSecret(name: string): Promise<void>;
}

export interface SessionStore {
  getMessages(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(agentId?: string): Promise<SessionSummary[]>;
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
  /**
   * Intermediate reply delivered via the synthetic `reply` tool. Phase 4 will
   * forward these to SSE consumers; the registry already broadcasts them.
   */
  | { type: "reply"; runId: string; sessionId: string; text: string; ts: string; seq: number }
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
// Traces — persistent span trees for observability
// ═══════════════════════════════════════════════════════════════════════

export type SpanKind = "run" | "manifest" | "step" | "invoke" | "model" | "tool";
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
  limit?: number;  // default 50, max 200
  cursor?: string; // opaque; encodes (startedAt, traceId)
}

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

/**
 * Persistent record of spans and trace summaries. Implementations are
 * owner-scoped — every read filters on `ownerId`, every write tags it.
 */
export interface TraceStore {
  insertSpan(span: Span): Promise<void>;
  insertSpansBatch(spans: Span[]): Promise<void>;
  updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void>;
  upsertSummary(summary: TraceSummary): Promise<void>;
  getTrace(traceId: string, ownerId: string): Promise<Span[]>;
  getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null>;
  listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }>;
  deleteTrace(traceId: string, ownerId: string): Promise<void>;
  /** Returns the number of traces (not spans) deleted. */
  deleteOlderThan(ownerId: string, before: Date): Promise<number>;
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
  RunStore &
  TraceStore &
  SkillStore &
  SecretStore &
  WebhookDeliveryStore &
  ScopableStore;

// ═══════════════════════════════════════════════════════════════════════
// Webhook deliveries — outbox table for outbound webhook POSTs.
//
// Webhook signing secrets live in the unified `SecretStore` (per-user,
// AES-256-GCM encrypted at rest). The dispatcher resolves the active secret
// by name at each delivery attempt — so an out-of-band rotation (via
// SecretStore.putSecret) is picked up on the next attempt without any
// pinning machinery.
// ═══════════════════════════════════════════════════════════════════════

export interface WebhookDelivery {
  id: string;
  runId: string;
  callbackUrl: string;
  /** Name of the SecretStore entry whose plaintext is the HMAC signing key. */
  secretName: string;
  payload: Record<string, unknown>;
  attempts: number;
  lastAttemptAt?: string;
  status: "pending" | "delivered" | "failed_permanent";
  lastError?: string;
  createdAt: string;
}

export interface WebhookDeliveryStore {
  /** Insert a new pending delivery; returns the row id. */
  insert(
    delivery: Omit<WebhookDelivery, "attempts" | "status" | "createdAt"> & {
      payload: Record<string, unknown>;
    },
  ): Promise<string>;
  updateStatus(
    id: string,
    status: WebhookDelivery["status"],
    lastError?: string,
  ): Promise<void>;
  /** Increment attempts and stamp `lastAttemptAt`; updates `lastError` opportunistically. */
  incrementAttempt(id: string, lastError?: string): Promise<void>;
  /**
   * Return pending deliveries, oldest first. `olderThan` is an ISO timestamp;
   * when set, rows with `createdAt >= olderThan` are excluded (useful for
   * future drain workers that re-attempt stale rows).
   */
  listPending(filter?: { olderThan?: string; limit?: number }): Promise<WebhookDelivery[]>;
}

// ═══════════════════════════════════════════════════════════════════════
// Model Provider
// ═══════════════════════════════════════════════════════════════════════

export interface ModelProvider {
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
  streamText?(options: GenerateTextOptions): Promise<ModelStreamResult>;
}

export interface ModelStreamResult {
  textStream: AsyncIterable<string>;
  toolCalls: Promise<Array<{ id: string; name: string; args: unknown; providerMetadata?: unknown }>>;
  usage: Promise<TokenUsage>;
  finishReason: Promise<string>;
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
}
