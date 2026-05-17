import type {
  RunnerConfig,
  AgentDefinition,
  ToolDefinition,
  ToolReference,
  InvokeOptions,
  InvokeResult,
  InvokeStream,
  StreamEvent,
  ToolCallRecord,
  ToolInfo,
  ToolContext,
  ContextEntry,
  ContentBlock,
  Message,
  InvocationLog,
  TokenUsage,
  AgentStore,
  SessionStore,
  ContextStore,
  LogStore,
  ProviderStore,
  ConnectionStore,
  SkillStore,
  SecretStore,
  ModelProvider,
  PendingChildResult,
  Reply,
  RunRegistry,
} from "./types.js";
import { isContentBlockArray, DEFAULT_REPLY_MAX_PER_RUN } from "./types.js";
import { normalizeImageBlocks } from "./image-fetcher.js";
import { flattenContentToText } from "./message-builder.js";
import type { AiSdkMessage } from "./message-builder.js";
import { buildHttpToolDefinition } from "./http-tool.js";
import type { AgentState } from "./http-tool.js";
import { ToolRegistry } from "./tool.js";
import { zodToJsonSchema } from "./utils/schema.js";
import {
  createSpawnAgentTool,
  createCheckAgentsTool,
  resolveSpawnable,
  DEFAULT_SPAWN_LIMITS,
} from "./tools/spawn-agent.js";
import type { SpawnableEntry } from "./tools/spawn-agent.js";
import { createUseSkillTool } from "./tools/use-skill.js";
import { createReplyTool } from "./tools/reply.js";
import { MemoryStore } from "./stores/memory.js";
import { AISDKModelProvider } from "./model-provider.js";
import { buildMessages, trimHistory } from "./message-builder.js";
import { trimHistoryWithSummary } from "./utils/summarize.js";
import { generateInvocationId, generateSessionId } from "./utils/id.js";
import { MCPClientManager } from "./mcp/client-manager.js";
import type { MCPTool } from "./mcp/client-manager.js";
import { resolveMCPServer as resolveMCPServerHelper } from "./mcp/resolve-server.js";
import {
  AgentNotFoundError,
  InvocationCancelledError,
  MaxStepsExceededError,
  MaxRecursionDepthError,
  ToolExecutionError,
  ToolNotFoundError,
} from "./errors.js";
import { runEval } from "./eval.js";
import type { EvalRunOptions } from "./eval.js";
import { withRetry } from "./utils/retry.js";
import type { RetryConfig } from "./utils/retry.js";
import { Telemetry } from "./telemetry.js";
import type { InvokeSpan } from "./telemetry.js";
import { computeCost } from "./model-pricing.js";

/** Maximum tool call iterations to prevent infinite loops */
const DEFAULT_MAX_STEPS = 10;

/** Default maximum recursion depth for agent-as-tool chains */
const DEFAULT_MAX_RECURSION_DEPTH = 3;

/**
 * Bonus iterations granted when entering the drain phase, so waiting for
 * outstanding children doesn't immediately exhaust `maxSteps`.
 */
const DRAIN_BUDGET = 16;

/**
 * Matches a `{{secrets.<name>}}` template reference. Used to walk an
 * agent's HTTP tool entries at invoke() time and pre-resolve the set of
 * secrets needed for this run.
 */
const SECRET_REF_RE = /\{\{\s*secrets\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Walk an agent's tool references and collect the unique set of secret
 * names referenced via `{{secrets.<name>}}` in any HTTP tool's `params`
 * or `headers` template values. Returned as a Set so callers can iterate
 * once and fetch each secret exactly once per run.
 */
function collectSecretReferences(agent: AgentDefinition): Set<string> {
  const names = new Set<string>();
  for (const ref of agent.tools ?? []) {
    if (ref.type !== "http") continue;
    const entry = ref.entry;
    const values: string[] = [];
    if (entry.params) values.push(...Object.values(entry.params));
    if (entry.headers) values.push(...Object.values(entry.headers));
    for (const v of values) {
      SECRET_REF_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SECRET_REF_RE.exec(v)) !== null) {
        names.add(m[1]);
      }
    }
  }
  return names;
}

/**
 * The Runner. Central orchestrator for agntz.
 * Created via createRunner().
 */
export class Runner {
  private agentStore: AgentStore;
  private sessionStore: SessionStore;
  private contextStore: ContextStore;
  private logStore: LogStore;
  private _providerStore: ProviderStore | undefined;
  private _connectionStore: ConnectionStore | undefined;
  private _skillStore: SkillStore | undefined;
  private _secretStore: SecretStore | undefined;
  private modelProvider: ModelProvider;
  private toolRegistry: ToolRegistry;
  private mcpManager: MCPClientManager | null = null;
  private mcpInitPromise: Promise<void> | null = null;
  private config: RunnerConfig;
  private telemetry: Telemetry;

  /** Agents registered in code (not persisted to store) */
  private registeredAgents = new Map<string, AgentDefinition>();

  constructor(config: RunnerConfig = {}) {
    this.config = config;

    // Set up stores — unified or split
    if (config.store) {
      this.agentStore = config.store;
      this.sessionStore = config.store;
      this.contextStore = config.store;
      this.logStore = config.store;
    } else {
      const defaultStore = new MemoryStore();
      this.agentStore = config.agentStore ?? defaultStore;
      this.sessionStore = config.sessionStore ?? defaultStore;
      this.contextStore = config.contextStore ?? defaultStore;
      this.logStore = config.logStore ?? defaultStore;
    }

    // Model provider — pass the provider store so it can look up API keys
    const unifiedStore = config.store;
    this._providerStore = unifiedStore && "getProvider" in unifiedStore
      ? unifiedStore as ProviderStore
      : undefined;
    this._connectionStore = unifiedStore && "getConnection" in unifiedStore
      ? unifiedStore as ConnectionStore
      : undefined;
    this._skillStore = unifiedStore && "getSkill" in unifiedStore
      ? unifiedStore as SkillStore
      : undefined;
    this._secretStore = unifiedStore && "getSecretValue" in unifiedStore
      ? unifiedStore as SecretStore
      : undefined;
    this.modelProvider = config.modelProvider ?? new AISDKModelProvider({
      providerStore: this._providerStore,
    });

    // Tool registry
    this.toolRegistry = new ToolRegistry();

    // Register initial tools
    if (config.tools) {
      for (const tool of config.tools) {
        this.toolRegistry.register(tool);
      }
    }

    // Initialize MCP client manager (lazy — connects on first use)
    if (config.mcp?.servers && Object.keys(config.mcp.servers).length > 0) {
      this.mcpManager = new MCPClientManager(config.mcp.servers);
    }

    // Initialize telemetry (no-op if not configured)
    this.telemetry = new Telemetry(config.telemetry);

  }

  /**
   * Ensure MCP servers are connected. Called lazily on first invoke
   * that needs MCP tools. Safe to call multiple times.
   */
  private async ensureMCPInitialized(): Promise<void> {
    if (!this.mcpManager) return;
    if (!this.mcpInitPromise) {
      this.mcpInitPromise = this.mcpManager.initialize();
    }
    await this.mcpInitPromise;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Store Access (for Studio integration)
  // ═══════════════════════════════════════════════════════════════════

  /** Access the agent store */
  get agents(): AgentStore { return this.agentStore; }
  /** Access the session store */
  get sessions(): SessionStore { return this.sessionStore; }
  /** Access the context store (raw) */
  get contexts(): ContextStore { return this.contextStore; }
  /** Access the log store */
  get logs(): LogStore { return this.logStore; }
  /** Access the provider store (if available) */
  get providers(): ProviderStore | undefined { return this._providerStore; }
  /** Access the connection store (if available) */
  get connections(): ConnectionStore | undefined { return this._connectionStore; }
  /** Access the model provider */
  get model(): ModelProvider { return this.modelProvider; }
  /** Access the runner config */
  get runnerConfig(): RunnerConfig { return this.config; }

  // ═══════════════════════════════════════════════════════════════════
  // Agent Management
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Register an agent in memory (not persisted to store).
   * For persisted agents, use the agent store directly.
   */
  registerAgent(agent: AgentDefinition): void {
    this.registeredAgents.set(agent.id, agent);
  }

  /**
   * Register a tool in the registry.
   */
  registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
  }

  /**
   * Resolve an agent by ID — checks registered agents first, then the store.
   */
  private async resolveAgent(agentId: string): Promise<AgentDefinition> {
    const registered = this.registeredAgents.get(agentId);
    if (registered) return registered;

    const stored = await this.agentStore.getAgent(agentId);
    if (stored) return stored;

    throw new AgentNotFoundError(agentId);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Tool Registry (public API)
  // ═══════════════════════════════════════════════════════════════════

  get tools() {
    return {
      list: (): ToolInfo[] => this.toolRegistry.list(),
      get: (name: string): ToolInfo | undefined => this.toolRegistry.get(name),
      execute: async (name: string, input: unknown): Promise<unknown> => {
        const ctx: ToolContext = {
          agentId: "__direct__",
          invocationId: generateInvocationId(),
          invoke: (agentId: string, input: string, options?: InvokeOptions) =>
            this.invoke(agentId, input, options),
        };
        return this.toolRegistry.execute(name, input, ctx);
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Context (public API)
  // ═══════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════
  // MCP (public API)
  // ═══════════════════════════════════════════════════════════════════

  get mcp() {
    return {
      /**
       * Get connection status for all MCP servers.
       */
      status: () => {
        if (!this.mcpManager) return [];
        return this.mcpManager.getStatus();
      },
      /**
       * Get status for a specific server.
       */
      serverStatus: (name: string) => {
        if (!this.mcpManager) return null;
        return this.mcpManager.getServerStatus(name);
      },
      /**
       * Force initialization of MCP connections.
       * Normally happens lazily on first invoke.
       */
      connect: async () => {
        await this.ensureMCPInitialized();
      },
    };
  }

  /**
   * Gracefully shut down the runner — closes MCP connections, flushes stores.
   * Safe to call multiple times.
   */
  async shutdown(): Promise<void> {
    const cleanups: Promise<void>[] = [];

    // Close MCP connections
    if (this.mcpManager) {
      cleanups.push(this.mcpManager.shutdown().catch(() => {}));
    }

    // Close stores that have a close() method (e.g., SQLite)
    for (const store of [this.agentStore, this.sessionStore, this.contextStore, this.logStore]) {
      if (store && typeof (store as any).close === "function") {
        cleanups.push(
          Promise.resolve((store as any).close()).catch(() => {})
        );
      }
    }

    await Promise.all(cleanups);
  }

  get context() {
    return {
      get: (contextId: string) => this.contextStore.getContext(contextId),
      add: (contextId: string, entry: Omit<ContextEntry, "contextId">) =>
        this.contextStore.addContext(contextId, { ...entry, contextId }),
      clear: (contextId: string) => this.contextStore.clearContext(contextId),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Evaluation
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Run the eval suite for an agent.
   */
  async eval(
    agentId: string,
    options: {
      testCases?: import("./types.js").EvalTestCase[];
      signal?: AbortSignal;
      onProgress?: (completed: number, total: number, testCase: string) => void;
    } = {}
  ): Promise<import("./types.js").EvalResult> {
    const agent = await this.resolveAgent(agentId);

    return runEval(agent, {
      testCases: options.testCases,
      invoke: (aid, input, opts) => this.invoke(aid, input, opts),
      modelProvider: this.modelProvider,
      signal: options.signal,
      onProgress: options.onProgress,
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Invocation
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Invoke an agent with streaming. Returns an async iterable of stream events.
   *
   * Parity with `invoke()`: supports `runRegistry`/`runId`, materializes a
   * top-level Run, injects child completions between steps, drains
   * outstanding children before terminating, dispatches ephemeral
   * `spawn_agent`/`check_agents` tools, and emits multiplexed events
   * (text-delta, tool-call-start, tool-call-end, step-complete, draining)
   * to the registry when one is wired.
   */
  stream(
    agentId: string,
    input: string | ContentBlock[],
    options: Omit<InvokeOptions, "stream"> = {},
  ): InvokeStream {
    const self = this;
    let resolveResult: (r: InvokeResult) => void;
    let rejectResult: (e: unknown) => void;
    const resultPromise = new Promise<InvokeResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    async function* generate(): AsyncGenerator<StreamEvent> {
      // Recursion depth (rare for stream but symmetric with invoke)
      const currentDepth = options._recursionDepth ?? 0;
      const maxDepth = self.config.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH;
      if (currentDepth > maxDepth) {
        throw new MaxRecursionDepthError(agentId, maxDepth);
      }

      // Ensure MCP servers are connected
      await self.ensureMCPInitialized();

      const startTime = Date.now();
      const invocationId = generateInvocationId();
      const agent = await self.resolveAgent(agentId);

      // Always work with a concrete sessionId — symmetric with invoke().
      const effectiveSessionId = options.sessionId ?? generateSessionId();
      await self.sessionStore.getOrCreateSession(effectiveSessionId);

      // For multimodal input the Run record/InvocationLog still need a string
      // — the flattened text view is what list UIs render and what spawn
      // semantics require. The actual blocks (with base64 image bodies) live
      // on the persisted Message and on InvocationLog.input.
      const inputAsString =
        typeof input === "string" ? input : flattenContentToText(input);

      // ─── Secrets pre-fetch ────────────────────────────────────────────
      // Mirror of the non-streaming invoke() path. See comments there for
      // the rationale. Resolves `{{secrets.<name>}}` references in HTTP
      // tools to plaintext once per invocation, kept in `state.secrets` so
      // `interpolate()` stays synchronous and per-invocation.
      const state: AgentState = {};
      const secretNames = collectSecretReferences(agent);
      if (secretNames.size > 0) {
        if (!self._secretStore) {
          throw new Error(
            `Agent '${agent.id}' references secrets but no SecretStore is wired to the Runner.`,
          );
        }
        const resolved: Record<string, string> = {};
        for (const name of secretNames) {
          const value = await self._secretStore.getSecretValue(name);
          if (value == null) {
            throw new Error(
              `Secret '${name}' referenced by agent '${agent.id}' does not exist for this user.`,
            );
          }
          resolved[name] = value;
        }
        state.secrets = resolved;
      }

      // ─── Cancel-and-replace concurrency + Run registration ────────────
      const runRegistry = options.runRegistry;
      let runId = options.runId;
      let rootId: string | undefined;
      if (runRegistry) {
        if (!runId) {
          const isTopLevel = currentDepth === 0 && !options.parentRunId;
          if (isTopLevel) {
            const release = await runRegistry.acquireSessionLock(effectiveSessionId);
            try {
              const activeRunId = runRegistry.findActiveBySession(effectiveSessionId);
              if (activeRunId) {
                runRegistry.cancel(activeRunId, "superseded");
                await runRegistry.waitForTerminal(activeRunId);
              }
              const root = runRegistry.create({
                agentId,
                input: inputAsString,
                parentRunId: options.parentRunId,
                userId: options.userId,
                sessionId: effectiveSessionId,
                spanEmitter: options.spanEmitter,
              });
              runId = root.id;
              rootId = root.rootId;
            } finally {
              release();
            }
          } else {
            const root = runRegistry.create({
              agentId,
              input: inputAsString,
              parentRunId: options.parentRunId,
              userId: options.userId,
              sessionId: effectiveSessionId,
              spanEmitter: options.spanEmitter,
            });
            runId = root.id;
            rootId = root.rootId;
          }
        } else {
          rootId = runRegistry.get(runId)?.rootId ?? runId;
        }
      }
      const ephemeralTools = new Map<string, ToolDefinition>();
      // Per-invocation set of loaded skills, shared across tool calls so the
      // use_skill tool sees a consistent view across turns.
      const loadedSkills = new Set<string>();
      const loadedSkillToolDescriptors: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      // Per-invocation reply collector — see invoke() for the contract. The
      // runId fallback to invocationId keeps Reply.runId stable when no
      // registry is wired.
      const replyCollector: Reply[] = [];
      const effectiveRunId = runId ?? invocationId;
      const effectiveRootId = rootId ?? effectiveRunId;

      // In-process pipe from the synthetic `reply` tool to this generator.
      // The tool's `onAccepted` callback pushes Reply records here as they
      // are accepted; the generator drains the queue at safe yield points
      // (between text-delta chunks, after each tool call, between steps) so
      // SSE consumers see reply events in real time instead of only on the
      // final `done` payload.
      const pendingStreamReplies: Reply[] = [];
      const onReplyAccepted = (reply: Reply) => {
        pendingStreamReplies.push(reply);
      };

      const modelConfig = {
        ...self.config.defaults?.model,
        ...agent.model,
        temperature: agent.model.temperature ?? self.config.defaults?.temperature,
        maxTokens: agent.model.maxTokens ?? self.config.defaults?.maxTokens,
      };
      const modelStr = `${modelConfig.provider}/${modelConfig.name}`;

      // Top-level invokes never go through registry.start(); bridge the
      // registry's AbortController so cancel-and-replace can interrupt
      // mid-loop model calls.
      const effectiveSignal = combineSignals(
        options.signal,
        runRegistry && runId ? runRegistry.getAbortSignal(runId) : undefined,
      );

      // Hoisted so the catch block can write an audit log entry even when a
      // cancel-and-replace abort interrupts the loop mid-flight.
      const allToolCalls: ToolCallRecord[] = [];
      const totalUsage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        model: modelConfig.name,
      };

      try {
        // Load session history
        let sessionHistory: Message[] = [];
        {
          sessionHistory = await self.sessionStore.getMessages(effectiveSessionId);
          const maxMessages = self.config.session?.maxMessages ?? 50;
          const strategy = self.config.session?.strategy ?? "sliding";

          if (strategy === "summary" && sessionHistory.length > maxMessages) {
            sessionHistory = await trimHistoryWithSummary(sessionHistory, {
              maxMessages,
              modelProvider: self.modelProvider,
              modelConfig: modelConfig as import("./types.js").ModelConfig,
              signal: effectiveSignal,
            });
          } else if (strategy !== "none") {
            sessionHistory = trimHistory(sessionHistory, maxMessages);
          }
        }

        // Load context
        let contextEntries: Map<string, ContextEntry[]> | undefined;
        if (options.contextIds?.length) {
          contextEntries = new Map();
          for (const contextId of options.contextIds) {
            const entries = await self.contextStore.getContext(contextId);
            if (entries.length > 0) {
              const maxEntries = self.config.context?.maxEntries ?? 20;
              contextEntries.set(contextId, entries.slice(-maxEntries));
            }
          }
        }

        // For multimodal input, fetch URLs → base64 BEFORE building the
        // model messages so the AI SDK sees ready-to-send image parts. The
        // normalized blocks (or original string) are also what we persist to
        // the session and to InvocationLog.input.
        const normalizedInput: string | ContentBlock[] = isContentBlockArray(input)
          ? await normalizeImageBlocks(input)
          : input;

        const messages = buildMessages({
          agent,
          input: normalizedInput,
          sessionHistory,
          contextEntries,
          extraContext: options.extraContext,
        });

        // Append "Available skills" section to the system prompt. Missing skills
        // are silently skipped — running with an unknown skill name is allowed.
        await self.augmentSystemPromptWithSkills(agent, messages);

        let availableTools = await self.resolveToolsForAgent(agent, {
          runRegistry,
          ephemeralTools,
          replyCollector,
          effectiveSessionId,
          runId: effectiveRunId,
          rootId: effectiveRootId,
          onReplyAccepted,
          state,
        });

        // See invoke() for the rationale. Persist the user turn up-front when
        // the agent can reply mid-run so reply rows land after the user row
        // in session history.
        const replyEnabled = Boolean(agent.reply);
        if (replyEnabled) {
          const nowEarly = new Date().toISOString();
          await self.sessionStore.append(effectiveSessionId, [
            { role: "user", content: normalizedInput, timestamp: nowEarly },
          ]);
        }

        // allToolCalls and totalUsage are hoisted above so a mid-loop cancel
        // can still produce an audit log entry.
        let finalOutput = "";
        let step = 0;

        const baseMaxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
        let inDrainPhase = false;
        let effectiveMaxSteps = baseMaxSteps;

        while (step < effectiveMaxSteps) {
          step++;

          if (effectiveSignal?.aborted) {
            throw new InvocationCancelledError();
          }

          // Inject deferred child completions at the top of each iteration.
          if (runRegistry && runId) {
            self.injectPendingCompletions(runRegistry, runId, messages);
          }

          const outputSchema = agent.outputSchema
            ? { name: `${agent.id}_output`, schema: agent.outputSchema }
            : undefined;

          let resultText: string;
          let resultToolCalls: Array<{ id: string; name: string; args: unknown }>;
          let stepFinishReason: string;
          let stepUsage: TokenUsage;

          if (self.modelProvider.streamText) {
            const streamResult = await self.modelProvider.streamText({
              model: modelConfig,
              // AiSdkMessage union widens content to string | AiMessagePart[];
              // ModelProvider.generateText was originally typed
              // content:string. The AI SDK accepts both at runtime — cast
              // through `unknown` for backward-compatible providers.
              messages: messages as unknown as Array<{ role: string; content: string }>,
              tools: availableTools.length > 0 ? availableTools : undefined,
              outputSchema,
              signal: effectiveSignal,
            });

            // Yield text deltas (both to the local stream and to the registry).
            let fullText = "";
            for await (const chunk of streamResult.textStream) {
              fullText += chunk;
              yield { type: "text-delta" as const, text: chunk };
              if (runRegistry && rootId && runId) {
                runRegistry.emit(rootId, {
                  type: "text-delta",
                  runId,
                  text: chunk,
                  seq: 0,
                });
              }
            }

            resultText = fullText;
            resultToolCalls = (await streamResult.toolCalls) ?? [];
            stepUsage = await streamResult.usage;
            stepFinishReason = await streamResult.finishReason;
          } else {
            // Fallback for providers without streaming
            const result = await self.modelProvider.generateText({
              model: modelConfig,
              messages: messages as unknown as Array<{ role: string; content: string }>,
              tools: availableTools.length > 0 ? availableTools : undefined,
              outputSchema,
              signal: effectiveSignal,
            });

            resultText = result.text;
            resultToolCalls = result.toolCalls ?? [];
            stepUsage = result.usage;
            stepFinishReason = result.finishReason;

            // For symmetry, emit the entire text as a single delta.
            if (resultText) {
              yield { type: "text-delta" as const, text: resultText };
              if (runRegistry && rootId && runId) {
                runRegistry.emit(rootId, {
                  type: "text-delta",
                  runId,
                  text: resultText,
                  seq: 0,
                });
              }
            }
          }

          totalUsage.promptTokens += stepUsage.promptTokens;
          totalUsage.completionTokens += stepUsage.completionTokens;
          totalUsage.totalTokens += stepUsage.totalTokens;

          // Termination + drain. See invoke() for the race rationale: a child
          // may have settled during streaming; its status is terminal but the
          // completion sits in the pending queue. Re-check both before
          // deciding whether to break.
          if (!resultToolCalls.length) {
            if (runRegistry && runId) {
              const hasOutstanding = runRegistry.outstandingChildrenCount(runId) > 0;
              const late = runRegistry.consumePending(runId);
              if (late.length > 0 || hasOutstanding) {
                if (resultText) {
                  messages.push({ role: "assistant", content: resultText });
                }
                for (const p of late) {
                  messages.push({ role: "user", content: formatChildCompletion(p) });
                }
                if (hasOutstanding) {
                  if (!inDrainPhase) {
                    inDrainPhase = true;
                    effectiveMaxSteps = step + DRAIN_BUDGET;
                  }
                  if (rootId) {
                    const pendingChildren = runRegistry
                      .children(runId)
                      .filter((c) => c.status === "pending" || c.status === "running")
                      .map((c) => c.id);
                    runRegistry.emit(rootId, {
                      type: "draining",
                      runId,
                      pendingChildren,
                      seq: 0,
                    });
                  }
                  await runRegistry.awaitNextSettled(runId, effectiveSignal);
                }
                continue;
              }
            }
            finalOutput = resultText;
            break;
          }

          // Execute tool calls
          const stepToolCalls: ToolCallRecord[] = [];
          let useSkillSucceeded = false;
          for (const tc of resultToolCalls) {
            yield {
              type: "tool-call-start" as const,
              toolCall: { id: tc.id, name: tc.name },
            };
            if (runRegistry && rootId && runId) {
              runRegistry.emit(rootId, {
                type: "tool-call-start",
                runId,
                toolCall: { id: tc.id, name: tc.name },
                seq: 0,
              });
            }

            const record = await self.executeToolCall({
              tc,
              agentId,
              options,
              invocationId,
              runId,
              runRegistry,
              ephemeralTools,
              loadedSkills,
              loadedSkillToolDescriptors,
              currentDepth,
              sessionId: effectiveSessionId,
            });

            // Detect a successful use_skill call (returns name+instructions) so
            // we know to re-resolve availableTools before the next model call.
            if (tc.name === "use_skill" && record.output && typeof record.output === "object") {
              const out = record.output as Record<string, unknown>;
              if (typeof out.instructions === "string" && typeof out.name === "string") {
                useSkillSucceeded = true;
              }
            }

            stepToolCalls.push(record);
            allToolCalls.push(record);

            yield { type: "tool-call-end" as const, toolCall: record };
            if (runRegistry && rootId && runId) {
              runRegistry.emit(rootId, {
                type: "tool-call-end",
                runId,
                toolCall: record,
                seq: 0,
              });
            }

            // Drain any replies queued during this tool call (the synthetic
            // `reply` tool's onAccepted callback pushes into the queue from
            // inside executeToolCall). Yielding here keeps reply events
            // chronologically attached to the tool call that produced them
            // and ahead of the next tool's tool-call-start.
            while (pendingStreamReplies.length > 0) {
              const r = pendingStreamReplies.shift()!;
              yield {
                type: "reply" as const,
                text: r.text,
                ts: r.ts,
                sessionId: r.sessionId,
                runId: r.runId,
              };
            }
          }

          yield { type: "step-complete" as const, step, toolCalls: stepToolCalls };
          if (runRegistry && rootId && runId) {
            runRegistry.emit(rootId, {
              type: "step-complete",
              runId,
              step,
              toolCalls: stepToolCalls,
              seq: 0,
            });
          }

          // Push tool-call assistant + tool-result messages so the next
          // model iteration can see them.
          if (resultText) {
            messages.push({ role: "assistant", content: resultText });
          }
          messages.push({
            role: "assistant",
            content: resultToolCalls
              .map((tc) => `[Tool Call: ${tc.name}(${JSON.stringify(tc.args)})]`)
              .join("\n"),
          });
          for (const r of stepToolCalls) {
            messages.push({
              role: "tool" as string,
              content: typeof r.output === "string" ? r.output : JSON.stringify(r.output),
            });
          }

          if (stepFinishReason === "stop" && resultText) {
            finalOutput = resultText;
            break;
          }

          // If any use_skill call succeeded this step, refresh the tool list
          // so the newly-registered skill tools show up on the next model turn.
          if (useSkillSucceeded) {
            const base = await self.resolveToolsForAgent(agent, {
              runRegistry,
              ephemeralTools,
              replyCollector,
              effectiveSessionId,
              runId: effectiveRunId,
              rootId: effectiveRootId,
              onReplyAccepted,
              state,
            });
            const seen = new Set(base.map((t) => t.name));
            availableTools = base.concat(
              loadedSkillToolDescriptors.filter((d) => !seen.has(d.name)),
            );
          }
        }

        if (step >= effectiveMaxSteps && !finalOutput) {
          throw new MaxStepsExceededError(agentId, baseMaxSteps);
        }

        const duration = Date.now() - startTime;

        // Persist session — but only if this run wasn't cancelled mid-loop.
        // A cancelled run shouldn't poison the conversation history; the
        // replacing run will re-persist the user input as part of its own
        // turn. Persist the normalized form (base64-materialized images) so
        // replaying the conversation doesn't require re-fetching URLs.
        //
        // Reply path: see invoke() — user + replies were persisted earlier,
        // so we only need the final assistant row here, and skip it when
        // empty replies already represent the response.
        if (!effectiveSignal?.aborted) {
          const now = new Date().toISOString();
          const newMessages: Message[] = [];
          if (!replyEnabled) {
            newMessages.push({ role: "user", content: normalizedInput, timestamp: now });
          }
          const skipEmptyAssistant = replyEnabled && !finalOutput && replyCollector.length > 0;
          if (!skipEmptyAssistant) {
            newMessages.push({
              role: "assistant",
              content: finalOutput,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              timestamp: now,
            });
          }
          if (newMessages.length > 0) {
            await self.sessionStore.append(effectiveSessionId, newMessages);
          }
        }

        // Context write
        if (agent.contextWrite && options.contextIds?.length && finalOutput) {
          for (const contextId of options.contextIds) {
            await self.contextStore.addContext(contextId, {
              contextId,
              agentId,
              invocationId,
              content: finalOutput,
              createdAt: new Date().toISOString(),
            });
          }
        }

        const cancelled = effectiveSignal?.aborted ?? false;

        // Log — preserve the normalized blocks (or original string) so the
        // input view rebuilds exactly what was sent to the model.
        await self.logStore.log({
          id: invocationId,
          agentId,
          sessionId: effectiveSessionId,
          input: normalizedInput,
          output: finalOutput,
          toolCalls: allToolCalls,
          usage: totalUsage,
          duration,
          model: modelStr,
          status: cancelled ? "cancelled" : "completed",
          timestamp: new Date().toISOString(),
        });

        const invokeResult: InvokeResult = {
          output: finalOutput,
          invocationId,
          sessionId: effectiveSessionId,
          toolCalls: allToolCalls,
          usage: totalUsage,
          duration,
          model: modelStr,
          ...(replyCollector.length > 0 ? { replies: replyCollector } : {}),
        };

        if (runRegistry && runId) {
          runRegistry.notifyCompleted(runId, invokeResult);
        }

        resolveResult!(invokeResult);
        yield { type: "done" as const, result: invokeResult };
      } catch (err) {
        // Audit-log the cancellation/failure even when the loop throws mid-flight.
        const cancelled =
          err instanceof InvocationCancelledError ||
          (effectiveSignal?.aborted ?? false);
        try {
          await self.logStore.log({
            id: invocationId,
            agentId,
            sessionId: effectiveSessionId,
            input,
            output: "",
            toolCalls: allToolCalls,
            usage: totalUsage,
            duration: Date.now() - startTime,
            model: modelStr,
            error: err instanceof Error ? err.message : String(err),
            status: cancelled ? "cancelled" : "failed",
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Log persistence failure should not mask the original error.
        }
        if (runRegistry && runId) {
          runRegistry.notifyFailed(runId, err);
        }
        rejectResult!(err);
        throw err;
      }
    }

    const iterable = generate();
    // Suppress "unhandled rejection" warnings for consumers that iterate the
    // stream (and surface errors via the iterator's throw) without separately
    // awaiting .result. Consumers can still await .result and catch normally;
    // attaching a noop here only prevents the *unhandled* classification.
    resultPromise.catch(() => {});
    return {
      [Symbol.asyncIterator]() { return iterable; },
      result: resultPromise,
    };
  }

  /**
   * Invoke an agent. This is the main entry point for running an agent.
   */
  async invoke(
    agentId: string,
    input: string | ContentBlock[],
    options: InvokeOptions = {},
  ): Promise<InvokeResult> {
    // Check recursion depth for agent-as-tool chains
    const currentDepth = options._recursionDepth ?? 0;
    const maxDepth = this.config.maxRecursionDepth ?? DEFAULT_MAX_RECURSION_DEPTH;
    if (currentDepth > maxDepth) {
      throw new MaxRecursionDepthError(agentId, maxDepth);
    }

    // Ensure MCP servers are connected before resolving tools
    await this.ensureMCPInitialized();

    const startTime = Date.now();
    const invocationId = generateInvocationId();
    const agent = await this.resolveAgent(agentId);

    // Always work with a concrete sessionId — auto-allocate if the caller
    // didn't pass one. The session row is ensured below so the id has a
    // persistent home before any messages get appended.
    const effectiveSessionId = options.sessionId ?? generateSessionId();
    await this.sessionStore.getOrCreateSession(effectiveSessionId);

    // For multimodal input the Run record/telemetry input still need a
    // string view (used by list UIs and span attributes); the actual blocks
    // (with base64 image bodies) live on the persisted Message and on
    // InvocationLog.input.
    const inputAsString =
      typeof input === "string" ? input : flattenContentToText(input);

    // ─── Secrets pre-fetch ────────────────────────────────────────────
    // Walk the agent's HTTP tool entries and pre-resolve every
    // `{{secrets.<name>}}` reference into a plain map. The decrypted
    // values live on `state.secrets` for the lifetime of this invocation
    // only — they go away with `state` when the function returns. This
    // keeps `interpolate()` synchronous at tool-execute time and means
    // we hit the secret store at most once per name per run.
    const state: AgentState = {};
    const secretNames = collectSecretReferences(agent);
    if (secretNames.size > 0) {
      if (!this._secretStore) {
        throw new Error(
          `Agent '${agent.id}' references secrets but no SecretStore is wired to the Runner.`,
        );
      }
      const resolved: Record<string, string> = {};
      for (const name of secretNames) {
        const value = await this._secretStore.getSecretValue(name);
        if (value == null) {
          throw new Error(
            `Secret '${name}' referenced by agent '${agent.id}' does not exist for this user.`,
          );
        }
        resolved[name] = value;
      }
      state.secrets = resolved;
    }

    // ─── Cancel-and-replace concurrency + Run registration ────────────
    // The per-session mutex must wrap "check active → cancel → create new",
    // because publishing this run's id as the session's active run is the
    // moment a concurrent caller can race. We release the lock as soon as
    // the new run is created and indexed; the model loop runs outside it.
    const runRegistry = options.runRegistry;
    let runId = options.runId;
    let rootId: string | undefined;
    if (runRegistry) {
      if (!runId) {
        // Only top-level invokes (no parentRunId, depth 0) participate in
        // cancel-and-replace. Children carry their own parent context.
        const isTopLevel = currentDepth === 0 && !options.parentRunId;
        if (isTopLevel) {
          const release = await runRegistry.acquireSessionLock(effectiveSessionId);
          try {
            const activeRunId = runRegistry.findActiveBySession(effectiveSessionId);
            if (activeRunId) {
              runRegistry.cancel(activeRunId, "superseded");
              await runRegistry.waitForTerminal(activeRunId);
            }
            const root = runRegistry.create({
              agentId,
              input: inputAsString,
              parentRunId: options.parentRunId,
              userId: options.userId,
              sessionId: effectiveSessionId,
              spanEmitter: options.spanEmitter,
            });
            runId = root.id;
            rootId = root.rootId;
          } finally {
            release();
          }
        } else {
          const root = runRegistry.create({
            agentId,
            input: inputAsString,
            parentRunId: options.parentRunId,
            userId: options.userId,
            sessionId: effectiveSessionId,
            spanEmitter: options.spanEmitter,
          });
          runId = root.id;
          rootId = root.rootId;
        }
      } else {
        rootId = runRegistry.get(runId)?.rootId ?? runId;
      }
    }

    // Top-level invokes don't go through registry.start(), so the registry's
    // AbortController isn't wired into the model call by default. Bridge it
    // here so cancel-and-replace can interrupt a mid-loop model call.
    const effectiveSignal = combineSignals(
      options.signal,
      runRegistry && runId ? runRegistry.getAbortSignal(runId) : undefined,
    );
    // Per-invocation ephemeral tools. spawn_agent/check_agents live here,
    // not in the global registry, because their schemas are agent-specific.
    const ephemeralTools = new Map<string, ToolDefinition>();
    // Per-invocation set of loaded skills, shared across tool calls so the
    // use_skill tool sees a consistent view across turns.
    const loadedSkills = new Set<string>();
    const loadedSkillToolDescriptors: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
    // Per-invocation reply collector. The synthetic `reply` tool pushes each
    // accepted reply onto this; we surface it on InvokeResult.replies at the
    // end of the run. Always allocated — the tool factory only sees it when
    // the agent declares `reply`. Effective runId is the registry-allocated
    // runId when one exists, else the invocationId so the Reply still has a
    // stable identifier.
    const replyCollector: Reply[] = [];
    const effectiveRunId = runId ?? invocationId;
    const effectiveRootId = rootId ?? effectiveRunId;

    // Resolve model config (agent model or defaults)
    const modelConfig = {
      ...this.config.defaults?.model,
      ...agent.model,
      temperature: agent.model.temperature ?? this.config.defaults?.temperature,
      maxTokens: agent.model.maxTokens ?? this.config.defaults?.maxTokens,
    };

    const modelStr = `${modelConfig.provider}/${modelConfig.name}`;

    // Use the per-request emitter when provided; fall back to the runner-level one.
    const spanEmitter = options.spanEmitter ?? this.telemetry;

    // Start telemetry span — span attributes are scalar text, so use the
    // flattened view (image bytes don't belong in a span attribute).
    const span = spanEmitter.startInvoke({
      agentId,
      invocationId,
      model: modelStr,
      ownerId: options.ownerId,
      sessionId: effectiveSessionId,
      contextIds: options.contextIds,
      input: inputAsString,
    });

    // Hoisted so the catch block can write an audit log entry even when a
    // cancel-and-replace abort interrupts the loop mid-flight.
    const allToolCalls: ToolCallRecord[] = [];
    const totalUsage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: modelConfig.name,
    };

    try {
      // Load session history
      let sessionHistory: Message[] = [];
      {
        sessionHistory = await this.sessionStore.getMessages(effectiveSessionId);
        const maxMessages = this.config.session?.maxMessages ?? 50;
        const strategy = this.config.session?.strategy ?? "sliding";

        if (strategy === "summary" && sessionHistory.length > maxMessages) {
          sessionHistory = await trimHistoryWithSummary(sessionHistory, {
            maxMessages,
            modelProvider: this.modelProvider,
            modelConfig: modelConfig as import("./types.js").ModelConfig,
            signal: effectiveSignal,
          });
        } else if (strategy !== "none") {
          sessionHistory = trimHistory(sessionHistory, maxMessages);
        }
      }

      // Load context entries
      let contextEntries: Map<string, ContextEntry[]> | undefined;
      if (options.contextIds?.length) {
        contextEntries = new Map();
        for (const contextId of options.contextIds) {
          const entries = await this.contextStore.getContext(contextId);
          if (entries.length > 0) {
            // Apply context limits
            const maxEntries = this.config.context?.maxEntries ?? 20;
            const trimmed = entries.slice(-maxEntries);
            contextEntries.set(contextId, trimmed);
          }
        }
      }

      // For multimodal input, fetch URLs → base64 BEFORE building the model
      // messages so the AI SDK sees ready-to-send image parts. The normalized
      // blocks (or original string) are also what we persist to the session
      // and to InvocationLog.input.
      const normalizedInput: string | ContentBlock[] = isContentBlockArray(input)
        ? await normalizeImageBlocks(input)
        : input;

      // Build messages
      const messages = buildMessages({
        agent,
        input: normalizedInput,
        sessionHistory,
        contextEntries,
        extraContext: options.extraContext,
      });

      // Append "Available skills" section to the system prompt. Missing skills
      // are silently skipped — running with an unknown skill name is allowed.
      await this.augmentSystemPromptWithSkills(agent, messages);

      // Resolve available tools for this agent (incl. spawn_agent/check_agents
      // when the agent declares `spawnable`, `reply` when the agent declares
      // `reply`, and HTTP tools — `state.secrets` was pre-resolved above so
      // those tools can interpolate `{{secrets.X}}` synchronously at execute
      // time).
      let availableTools = await this.resolveToolsForAgent(agent, {
        runRegistry,
        ephemeralTools,
        replyCollector,
        effectiveSessionId,
        runId: effectiveRunId,
        rootId: effectiveRootId,
        state,
      });

      // When the agent can reply mid-run, persist the user input *before* the
      // model loop. Otherwise the reply tool's at-call-time assistant writes
      // would land in the session before the user turn, jumbling history.
      // The end-of-run persistence path below only writes the final assistant
      // row in that case.
      const replyEnabled = Boolean(agent.reply);
      if (replyEnabled) {
        const now = new Date().toISOString();
        await this.sessionStore.append(effectiveSessionId, [
          { role: "user", content: normalizedInput, timestamp: now },
        ]);
      }

      // Execute the agent loop (model → tools → repeat). allToolCalls and
      // totalUsage are hoisted above so a mid-loop cancel can still produce
      // an audit log entry.
      let finalOutput = "";
      let step = 0;

      const baseMaxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
      let inDrainPhase = false;
      let effectiveMaxSteps = baseMaxSteps;

      while (step < effectiveMaxSteps) {
        step++;

        // Check for cancellation (either caller-supplied signal or our own
        // registry-driven cancel)
        if (effectiveSignal?.aborted) {
          throw new InvocationCancelledError();
        }

        // Inject any deferred child completions at the top of each iteration.
        // These look like normal "user" messages tagged so the LLM can correlate
        // them with its earlier spawn_agent calls.
        if (runRegistry && runId) {
          this.injectPendingCompletions(runRegistry, runId, messages);
        }

        // Build output schema if the agent defines one
        const outputSchema = agent.outputSchema
          ? { name: `${agent.id}_output`, schema: agent.outputSchema }
          : undefined;

        // Start model call span
        const modelSpan = span.modelCall({ model: modelStr, step });

        let result;
        try {
          // Call the model (with retry). effectiveSignal aborts on either
          // caller cancel or registry-driven cancel-and-replace.
          result = await withRetry(
            () => this.modelProvider.generateText({
              model: modelConfig,
              // See stream() — AiSdkMessage union widens content to
              // string | AiMessagePart[]; cast through `unknown` for the
              // legacy-typed ModelProvider interface.
              messages: messages as unknown as Array<{ role: string; content: string }>,
              tools: availableTools.length > 0 ? availableTools : undefined,
              outputSchema,
              signal: effectiveSignal,
            }),
            this.config.retry,
            effectiveSignal,
          );

          const costUsd = computeCost(result.usage, modelConfig.provider, modelConfig.name);
          modelSpan.setResult({
            usage: { ...result.usage, model: modelConfig.name },
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls?.length ?? 0,
            costUsd: costUsd ?? undefined,
            prompt: messages,
            completion: result.text,
          });
          modelSpan.end();
        } catch (err) {
          modelSpan.error(err instanceof Error ? err : new Error(String(err)));
          throw err;
        }

        // Accumulate usage
        totalUsage.promptTokens += result.usage.promptTokens;
        totalUsage.completionTokens += result.usage.completionTokens;
        totalUsage.totalTokens += result.usage.totalTokens;

        // Termination rule. Without a registry: classic "no tool calls → done".
        // With a registry: a child may have settled *during* this model call
        // — its status flipped to terminal but the completion is still in the
        // pending queue. Re-check both queue + outstanding before deciding.
        if (!result.toolCalls?.length) {
          if (runRegistry && runId) {
            const hasOutstanding = runRegistry.outstandingChildrenCount(runId) > 0;
            const late = runRegistry.consumePending(runId);
            if (late.length > 0 || hasOutstanding) {
              if (result.text) {
                messages.push({ role: "assistant", content: result.text });
              }
              for (const p of late) {
                messages.push({ role: "user", content: formatChildCompletion(p) });
              }
              if (hasOutstanding) {
                if (!inDrainPhase) {
                  inDrainPhase = true;
                  effectiveMaxSteps = step + DRAIN_BUDGET;
                }
                if (rootId) {
                  const pendingChildren = runRegistry
                    .children(runId)
                    .filter((c) => c.status === "pending" || c.status === "running")
                    .map((c) => c.id);
                  runRegistry.emit(rootId, {
                    type: "draining",
                    runId,
                    pendingChildren,
                    seq: 0,
                  });
                }
                await runRegistry.awaitNextSettled(runId, effectiveSignal);
              }
              continue;
            }
          }
          finalOutput = result.text;
          break;
        }

        // Execute tool calls
        const toolResults: Array<{ id: string; result: string }> = [];
        let useSkillSucceeded = false;

        for (const tc of result.toolCalls) {
          const toolSpan = span.toolCall({ toolName: tc.name, toolCallId: tc.id });

          // Emit tool-call-start to the registry (if wired).
          if (runRegistry && rootId && runId) {
            runRegistry.emit(rootId, {
              type: "tool-call-start",
              runId,
              toolCall: { id: tc.id, name: tc.name },
              seq: 0,
            });
          }

          const record = await this.executeToolCall({
            tc,
            agentId,
            options,
            invocationId,
            runId,
            runRegistry,
            ephemeralTools,
            loadedSkills,
            loadedSkillToolDescriptors,
            currentDepth,
            sessionId: effectiveSessionId,
          });
          allToolCalls.push(record);

          // Detect a successful use_skill call (returns name+instructions) so
          // we know to re-resolve availableTools before the next model call.
          if (tc.name === "use_skill" && record.output && typeof record.output === "object") {
            const out = record.output as Record<string, unknown>;
            if (typeof out.instructions === "string" && typeof out.name === "string") {
              useSkillSucceeded = true;
            }
          }

          toolSpan.setResult(record);
          if (record.error) {
            toolSpan.error(record.error);
          } else {
            toolSpan.end();
          }

          toolResults.push({
            id: tc.id,
            result: typeof record.output === "string" ? record.output : JSON.stringify(record.output),
          });

          // Emit tool-call-end to the registry.
          if (runRegistry && rootId && runId) {
            runRegistry.emit(rootId, {
              type: "tool-call-end",
              runId,
              toolCall: record,
              seq: 0,
            });
          }
        }

        // step-complete event
        if (runRegistry && rootId && runId) {
          runRegistry.emit(rootId, {
            type: "step-complete",
            runId,
            step,
            toolCalls: allToolCalls.slice(allToolCalls.length - result.toolCalls.length),
            seq: 0,
          });
        }

        // Add assistant message with tool calls to the conversation
        if (result.text) {
          messages.push({ role: "assistant", content: result.text });
        }

        // Add tool call request as assistant message
        messages.push({
          role: "assistant",
          content: result.toolCalls.map(tc =>
            `[Tool Call: ${tc.name}(${JSON.stringify(tc.args)})]`
          ).join("\n"),
        });

        // Add tool results
        for (const tr of toolResults) {
          messages.push({ role: "tool" as string, content: tr.result });
        }

        // If the model also produced text along with tool calls, that's the final output
        if (result.finishReason === "stop" && result.text) {
          finalOutput = result.text;
          break;
        }

        // If any use_skill call succeeded this step, refresh the tool list
        // so the newly-registered skill tools show up on the next model turn.
        if (useSkillSucceeded) {
          const base = await this.resolveToolsForAgent(agent, {
            runRegistry,
            ephemeralTools,
            replyCollector,
            effectiveSessionId,
            runId: effectiveRunId,
            rootId: effectiveRootId,
            state,
          });
          const seen = new Set(base.map((t) => t.name));
          availableTools = base.concat(
            loadedSkillToolDescriptors.filter((d) => !seen.has(d.name)),
          );
        }
      }

      const duration = Date.now() - startTime;

      // Set telemetry result
      span.setResult({
        output: finalOutput,
        usage: totalUsage,
        duration,
        toolCallCount: allToolCalls.length,
        stepCount: step,
      });

      // Save to session — but only if this run wasn't cancelled mid-loop.
      // A cancelled run shouldn't poison the conversation history; the
      // replacing run will re-persist the user input as part of its own
      // turn. Tool side effects already executed remain in InvocationLog.
      // Persist the normalized form (base64-materialized images) so replaying
      // the conversation doesn't require re-fetching URLs.
      //
      // Reply path: when `agent.reply` is set, the user message and each
      // reply row were already persisted earlier (user up-front, replies at
      // call time). Only append the final assistant row here, and skip it
      // entirely when the model produced no final text — the replies are
      // the agent's response and a trailing empty row just clutters history.
      if (!effectiveSignal?.aborted) {
        const now = new Date().toISOString();
        const newMessages: Message[] = [];
        if (!replyEnabled) {
          newMessages.push({ role: "user", content: normalizedInput, timestamp: now });
        }
        const skipEmptyAssistant = replyEnabled && !finalOutput && replyCollector.length > 0;
        if (!skipEmptyAssistant) {
          newMessages.push({
            role: "assistant",
            content: finalOutput,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            timestamp: now,
          });
        }
        if (newMessages.length > 0) {
          await this.sessionStore.append(effectiveSessionId, newMessages);
        }
      }

      // Write to context if agent has contextWrite enabled
      if (agent.contextWrite && options.contextIds?.length && finalOutput) {
        for (const contextId of options.contextIds) {
          await this.contextStore.addContext(contextId, {
            contextId,
            agentId,
            invocationId,
            content: finalOutput,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Log the invocation. Record cancellation status for auditability so
      // the token bill, tool calls, and any partial output are still
      // attributable even when the run was superseded.
      const cancelled = effectiveSignal?.aborted ?? false;
      const logEntry: InvocationLog = {
        id: invocationId,
        agentId,
        sessionId: effectiveSessionId,
        input: normalizedInput,
        output: finalOutput,
        toolCalls: allToolCalls,
        usage: totalUsage,
        duration,
        model: modelStr,
        status: cancelled ? "cancelled" : "completed",
        timestamp: new Date().toISOString(),
      };
      await this.logStore.log(logEntry);

      span.end();

      const invokeResult: InvokeResult = {
        output: finalOutput,
        invocationId,
        sessionId: effectiveSessionId,
        toolCalls: allToolCalls,
        usage: totalUsage,
        duration,
        model: modelStr,
        ...(replyCollector.length > 0 ? { replies: replyCollector } : {}),
      };

      if (runRegistry && runId) {
        runRegistry.notifyCompleted(runId, invokeResult);
      }

      return invokeResult;
    } catch (err) {
      span.error(err instanceof Error ? err : new Error(String(err)));
      // Write an audit log entry even on cancel/failure so token usage and
      // tool calls executed before the abort remain attributable.
      const cancelled =
        err instanceof InvocationCancelledError ||
        (effectiveSignal?.aborted ?? false);
      try {
        await this.logStore.log({
          id: invocationId,
          agentId,
          sessionId: effectiveSessionId,
          input,
          output: "",
          toolCalls: allToolCalls,
          usage: totalUsage,
          duration: Date.now() - startTime,
          model: modelStr,
          error: err instanceof Error ? err.message : String(err),
          status: cancelled ? "cancelled" : "failed",
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Persistence failure on the audit log shouldn't mask the original.
      }
      if (runRegistry && runId) {
        runRegistry.notifyFailed(runId, err);
      }
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Shared helpers used by both invoke() and stream()
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Append an "Available skills" section to the system message describing each
   * skill the agent declares. Missing skills are silently skipped — deferred
   * resolution is allowed by the spec. No-op if the agent has no skills, no
   * skill store is wired, or the first message is not a system message.
   */
  private async augmentSystemPromptWithSkills(
    agent: AgentDefinition,
    messages: AiSdkMessage[],
  ): Promise<void> {
    if (!agent.skills?.length || !this._skillStore) return;
    const sys = messages[0];
    if (!sys || sys.role !== "system") return;
    if (typeof sys.content !== "string") return;

    const lines: string[] = [];
    for (const name of agent.skills) {
      const def = await this._skillStore.getSkill(name);
      if (!def) continue;
      lines.push(`  - ${def.name}: ${def.description}`);
    }
    if (lines.length === 0) return;

    sys.content +=
      `\n\n## Available skills\n` +
      `Call use_skill("<name>") to load a skill's instructions and tools mid-run.\n\n` +
      lines.join("\n");
  }

  /**
   * Take any queued child-Run completions for `runId` and append them as
   * synthetic "user" messages so the next model iteration can correlate
   * each `spawn_agent` handle with its result.
   *
   * Mutates `messages` in place. No-op if the registry queue is empty.
   */
  private injectPendingCompletions(
    registry: RunRegistry,
    runId: string,
    messages: AiSdkMessage[],
  ): number {
    const pending = registry.consumePending(runId);
    for (const p of pending) {
      messages.push({
        role: "user",
        content: formatChildCompletion(p),
      });
    }
    return pending.length;
  }

  /**
   * Execute a single tool call. Looks up ephemeral tools (per-invocation
   * `spawn_agent`/`check_agents`) first; falls back to the global registry.
   * Builds the per-call ToolContext including the recursive invoke binding.
   * Returns a fully-populated `ToolCallRecord` (with `error` set on failure).
   *
   * Critical errors (MaxRecursionDepth, InvocationCancelled) re-throw so the
   * outer loop can surface them. Non-critical errors are captured as the
   * record's `error` field with `output = { error }`.
   */
  private async executeToolCall(params: {
    tc: { id: string; name: string; args: unknown };
    agentId: string;
    options: InvokeOptions;
    invocationId: string;
    runId?: string;
    runRegistry?: RunRegistry;
    ephemeralTools: Map<string, ToolDefinition>;
    loadedSkills: Set<string>;
    loadedSkillToolDescriptors: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
    currentDepth: number;
    /** Effective sessionId (auto-allocated if caller passed none). */
    sessionId?: string;
  }): Promise<ToolCallRecord> {
    const {
      tc,
      agentId,
      options,
      invocationId,
      runId,
      runRegistry,
      ephemeralTools,
      loadedSkills,
      loadedSkillToolDescriptors,
      currentDepth,
      sessionId,
    } = params;

    const toolStartTime = Date.now();
    const toolCtx: ToolContext = {
      agentId,
      sessionId: sessionId ?? options.sessionId,
      contextIds: options.contextIds,
      invocationId,
      runId,
      userId: options.userId,
      runRegistry,
      loadedSkills,
      skillStore: this._skillStore,
      registerSkillTools: async (refs) => {
        const descriptors = await this.toolRegistry.registerToolReferences(refs, {
          resolveAgentAsTool: (id) => this.resolveAgentAsTool(id),
          resolveMCPTools: (server, tools) => this.resolveMCPTools(server, tools),
          ensureMCPServerRegistered: (s) => this.ensureMCPServerRegistered(s),
        });
        for (const d of descriptors) {
          if (!loadedSkillToolDescriptors.some((existing) => existing.name === d.name)) {
            loadedSkillToolDescriptors.push(d);
          }
        }
        return descriptors;
      },
      _recursionDepth: currentDepth,
      invoke: (innerAgentId: string, innerInput: string, innerOpts?: InvokeOptions) =>
        this.invoke(innerAgentId, innerInput, {
          ...innerOpts,
          _recursionDepth: (innerOpts?._recursionDepth ?? currentDepth) + 1,
        }),
      ...(options.toolContext ?? {}),
    } as ToolContext;

    let output: unknown;
    let error: string | undefined;

    try {
      const ephemeral = ephemeralTools.get(tc.name);
      if (ephemeral) {
        const validatedArgs = ephemeral.input.parse(tc.args);
        output = await ephemeral.execute(validatedArgs, toolCtx);
      } else {
        output = await this.toolRegistry.execute(tc.name, tc.args, toolCtx);
      }
    } catch (err) {
      // Propagate critical errors so the outer loop can surface them.
      if (err instanceof MaxRecursionDepthError || err instanceof InvocationCancelledError) {
        throw err;
      }
      error = err instanceof Error ? err.message : String(err);
      output = { error };
    }

    return {
      id: tc.id,
      name: tc.name,
      input: tc.args,
      output,
      duration: Date.now() - toolStartTime,
      error,
    };
  }

  /**
   * Resolve the tools available to an agent based on its tools[] references.
   * Returns tool metadata for the model AND registers ephemeral tools
   * in the registry so they can be executed during the invoke loop.
   *
   * If the agent declares `spawnable` and a `runRegistry` is provided,
   * also synthesizes per-invocation `spawn_agent` and `check_agents` tools.
   * These live in the supplied `ephemeralTools` map (not the global registry)
   * because their schemas are agent-specific.
   *
   * HTTP tools also live in `ephemeralTools` because they close over the
   * per-invocation `state` (notably `state.secrets`); registering them
   * globally would either leak secrets across invocations or hit the
   * "already registered" guard the second time.
   */
  private async resolveToolsForAgent(
    agent: AgentDefinition,
    opts?: {
      runRegistry?: RunRegistry;
      ephemeralTools?: Map<string, ToolDefinition>;
      /** Buffer the synthetic `reply` tool pushes accepted replies into. */
      replyCollector?: Reply[];
      /** Effective session id for the current invocation. */
      effectiveSessionId?: string;
      /** Run id for the current invocation. */
      runId?: string;
      /** Root run id; defaults to `runId` for top-level runs. */
      rootId?: string;
      /**
       * Optional callback the synthetic `reply` tool fires after each
       * accepted reply. Used by `Runner.stream` to forward replies to its
       * async iterator output without re-subscribing to the registry.
       */
      onReplyAccepted?: (reply: Reply) => void;
      /**
       * Per-invocation template state (carries `secrets`, etc.). Required
       * for HTTP tool resolution; ignored by other tool kinds. Defaults
       * to an empty object when omitted so existing call sites that don't
       * use HTTP tools keep working.
       */
      state?: AgentState;
    },
  ): Promise<Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>> {
    const hasSpawnable =
      Boolean(agent.spawnable?.length) && Boolean(opts?.runRegistry) && Boolean(opts?.ephemeralTools);
    const hasSkills =
      Boolean(agent.skills?.length) && Boolean(this._skillStore) && Boolean(opts?.ephemeralTools);
    const hasReply =
      Boolean(agent.reply) &&
      Boolean(opts?.ephemeralTools) &&
      Boolean(opts?.replyCollector) &&
      Boolean(opts?.effectiveSessionId) &&
      Boolean(opts?.runId);
    if (!agent.tools?.length && !hasSpawnable && !hasSkills && !hasReply) return [];

    // Ensure every referenced MCP server is connected (resolving registered
    // connection names to urls/headers) before we ask for its tools. Headers
    // come from the entry when present so URL-based servers can authenticate.
    const mcpEntries = (agent.tools ?? []).filter(
      (r): r is Extract<typeof r, { type: "mcp" }> => r.type === "mcp",
    );
    const mcpRefs = new Map<string, Record<string, string> | undefined>();
    for (const e of mcpEntries) {
      if (!mcpRefs.has(e.server)) mcpRefs.set(e.server, e.headers);
    }
    for (const [ref, headers] of mcpRefs) {
      await this.ensureMCPServerRegistered(ref, headers);
    }

    const resolved: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }> = [];

    const state = opts?.state ?? {};

    for (const ref of agent.tools ?? []) {
      if (ref.type === "inline") {
        const info = this.toolRegistry.get(ref.name);
        if (info) {
          resolved.push({
            name: info.name,
            description: info.description,
            parameters: info.inputSchema,
          });
        }
      } else if (ref.type === "agent") {
        const toolInfo = this.resolveAgentAsTool(ref.agentId);
        if (toolInfo) {
          resolved.push(toolInfo);
        }
      } else if (ref.type === "mcp") {
        const mcpTools = this.resolveMCPTools(ref.server, ref.tools);
        resolved.push(...mcpTools);
      } else if (ref.type === "http") {
        // HTTP tools close over `state` (which carries decrypted secrets),
        // so they MUST live in the per-invocation ephemeral map. The same
        // entry called from two concurrent invocations would otherwise
        // share whichever closure won the registration race.
        if (!opts?.ephemeralTools) {
          // No ephemeral map → no place to put this tool. Skip rather
          // than mutate the global registry.
          continue;
        }
        const httpTool = buildHttpToolDefinition(ref.entry, state);
        opts.ephemeralTools.set(httpTool.name, httpTool);
        resolved.push({
          name: httpTool.name,
          description: httpTool.description,
          parameters: zodToJsonSchema(httpTool.input),
        });
      }
    }

    // Synthesize spawn_agent / check_agents per-invocation. These are NOT
    // installed into the global ToolRegistry — their schemas (the enum of
    // allowed agent ids) are specific to this agent and would collide if the
    // same Runner were used for multiple agents with different spawnable lists.
    if (hasSpawnable) {
      const entries: SpawnableEntry[] = await resolveSpawnable(agent.spawnable!, {
        resolveStored: async (id: string) => {
          const reg = this.registeredAgents.get(id);
          if (reg) return reg;
          return this.agentStore.getAgent(id);
        },
        registerInline: (def: AgentDefinition) => this.registerAgent(def),
      });

      const spawn = createSpawnAgentTool(entries, DEFAULT_SPAWN_LIMITS);
      if (spawn) {
        opts!.ephemeralTools!.set(spawn.name, spawn);
        resolved.push({
          name: spawn.name,
          description: spawn.description,
          parameters: zodToJsonSchema(spawn.input),
        });
      }
      const check = createCheckAgentsTool(entries);
      if (check) {
        opts!.ephemeralTools!.set(check.name, check);
        resolved.push({
          name: check.name,
          description: check.description,
          parameters: zodToJsonSchema(check.input),
        });
      }
    }

    // Synthesize use_skill per-invocation. The enum of allowed skill names is
    // specific to this agent, so this tool lives in the ephemeral map.
    if (hasSkills) {
      const useSkill = createUseSkillTool(agent.skills!);
      if (useSkill) {
        opts!.ephemeralTools!.set(useSkill.name, useSkill);
        resolved.push({
          name: useSkill.name,
          description: useSkill.description,
          parameters: zodToJsonSchema(useSkill.input),
        });
      }
    }

    // Synthesize the per-invocation `reply` tool. Lives in the ephemeral map
    // because it closes over this invocation's `collector`, `sessionId`, and
    // `runId`. Registering it globally would leak state across runs.
    if (hasReply) {
      const maxPerRun =
        typeof agent.reply === "object"
          ? (agent.reply.maxPerRun ?? DEFAULT_REPLY_MAX_PER_RUN)
          : DEFAULT_REPLY_MAX_PER_RUN;
      const replyTool = createReplyTool({
        collector: opts!.replyCollector!,
        sessionId: opts!.effectiveSessionId!,
        runId: opts!.runId!,
        rootId: opts!.rootId,
        sessionStore: this.sessionStore,
        runRegistry: opts!.runRegistry,
        maxPerRun,
        onAccepted: opts!.onReplyAccepted,
      });
      opts!.ephemeralTools!.set(replyTool.name, replyTool);
      resolved.push({
        name: replyTool.name,
        description: replyTool.description,
        parameters: zodToJsonSchema(replyTool.input),
      });
    }

    return resolved;
  }

  /**
   * Lazily connect to an MCP server referenced by an agent. Looks up the ref
   * in the user's ConnectionStore (registered name → url/headers); falls back
   * to treating the ref as a URL. Keyed by the raw ref so resolveMCPTools can
   * look up tools by `entry.server` unchanged.
   *
   * `entryHeaders` lets URL-based entries supply auth headers from the
   * manifest. They're merged onto any registered headers for the same ref.
   */
  private async ensureMCPServerRegistered(
    ref: string,
    entryHeaders?: Record<string, string>,
  ): Promise<void> {
    if (!this.mcpManager) {
      this.mcpManager = new MCPClientManager({});
    }
    if (this.mcpManager.hasServer(ref)) return;

    const resolved = this._connectionStore
      ? await resolveMCPServerHelper(ref, this._connectionStore, entryHeaders)
      : { url: ref, headers: entryHeaders };

    await this.mcpManager.addServer(ref, {
      url: resolved.url,
      headers: resolved.headers,
    });
  }

  /**
   * Resolve MCP tools from a server. Registers them in the tool registry
   * as synthetic inline tools that proxy to the MCP server.
   */
  private resolveMCPTools(
    serverName: string,
    toolNames?: string[]
  ): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    if (!this.mcpManager) return [];

    const mcpTools = this.mcpManager.getToolsFromServer(serverName, toolNames);
    const resolved: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }> = [];

    for (const mcpTool of mcpTools) {
      // Use a namespaced tool name to avoid collisions
      const qualifiedName = `mcp__${serverName}__${mcpTool.name}`;

      // Register as a synthetic tool in the registry if not already there
      if (!this.toolRegistry.get(qualifiedName)) {
        const { z } = require("zod");
        const tool: ToolDefinition = {
          name: qualifiedName,
          description: mcpTool.description,
          input: z.object({}).passthrough(), // Accept any input — MCP handles validation
          async execute(input: unknown) {
            return mcpTool.execute(input);
          },
        };
        this.toolRegistry.register(tool);
      }

      resolved.push({
        // Use the original tool name for the model (more natural)
        name: qualifiedName,
        description: mcpTool.description,
        parameters: mcpTool.inputSchema,
      });
    }

    return resolved;
  }

  /**
   * Resolve an agent-as-tool reference. Creates a synthetic tool in the registry
   * that invokes the target agent when called.
   */
  private resolveAgentAsTool(agentId: string): {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  } | null {
    const toolName = `invoke_${agentId}`;

    // If already registered (from a previous resolve), just return the info
    const existing = this.toolRegistry.get(toolName);
    if (existing) {
      return {
        name: existing.name,
        description: existing.description,
        parameters: existing.inputSchema,
      };
    }

    // Look up the target agent to get its description
    const targetAgent = this.registeredAgents.get(agentId);
    const description = targetAgent
      ? `Invoke the "${targetAgent.name}" agent: ${targetAgent.description ?? targetAgent.systemPrompt.slice(0, 100)}`
      : `Invoke the "${agentId}" agent`;

    // Dynamically import zod to create the schema
    // We use a simple schema: { input: string }
    const { z } = require("zod");

    const self = this;
    const agentTool: ToolDefinition = {
      name: toolName,
      description,
      input: z.object({
        input: z.string().describe("The input/question to send to the agent"),
      }),
      async execute(input: { input: string }, ctx: ToolContext) {
        // Pass recursion depth through to prevent infinite agent chains
        const parentDepth = (ctx as any)._recursionDepth ?? 0;
        const result = await ctx.invoke(agentId, input.input, {
          _recursionDepth: parentDepth + 1,
        });
        return { output: result.output, toolCalls: result.toolCalls.length };
      },
    };

    this.toolRegistry.register(agentTool);

    const info = this.toolRegistry.get(toolName);
    return info ? {
      name: info.name,
      description: info.description,
      parameters: info.inputSchema,
    } : null;
  }
}

/**
 * Create a runner instance. This is the primary entry point for agntz.
 */
export function createRunner(config: RunnerConfig = {}): Runner {
  return new Runner(config);
}

/**
 * Combine zero or more AbortSignals into one. The returned signal aborts as
 * soon as any input signal aborts. Returns undefined if no signals were
 * supplied — callers can pass it through unchanged.
 */
function combineSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => Boolean(s));
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  const ctrl = new AbortController();
  for (const s of present) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * Format a settled child Run as a synthetic message that the parent's LLM
 * sees on the next iteration. The parent correlates by `run_id`.
 */
function formatChildCompletion(p: {
  childRunId: string;
  agentId: string;
  payload:
    | { ok: true; output: string }
    | { ok: false; error: string; cancelled?: boolean };
}): string {
  if (p.payload.ok) {
    return (
      `[Spawned agent completion] run_id=${p.childRunId} agent_id=${p.agentId} status=completed\n` +
      `output:\n${p.payload.output}`
    );
  }
  if (p.payload.cancelled) {
    return `[Spawned agent completion] run_id=${p.childRunId} agent_id=${p.agentId} status=cancelled`;
  }
  return (
    `[Spawned agent completion] run_id=${p.childRunId} agent_id=${p.agentId} status=failed\n` +
    `error: ${p.payload.error}`
  );
}
