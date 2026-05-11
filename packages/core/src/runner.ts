import type {
  RunnerConfig,
  AgentDefinition,
  ToolDefinition,
  InvokeOptions,
  InvokeResult,
  InvokeStream,
  StreamEvent,
  ToolCallRecord,
  ToolInfo,
  ToolContext,
  ContextEntry,
  Message,
  InvocationLog,
  TokenUsage,
  AgentStore,
  SessionStore,
  ContextStore,
  LogStore,
  ProviderStore,
  ConnectionStore,
  ModelProvider,
  PendingChildResult,
  RunRegistry,
} from "./types.js";
import { ToolRegistry } from "./tool.js";
import { zodToJsonSchema } from "./utils/schema.js";
import {
  createSpawnAgentTool,
  createCheckAgentsTool,
  resolveSpawnable,
  DEFAULT_SPAWN_LIMITS,
} from "./tools/spawn-agent.js";
import type { SpawnableEntry } from "./tools/spawn-agent.js";
import { MemoryStore } from "./stores/memory.js";
import { AISDKModelProvider } from "./model-provider.js";
import { buildMessages, trimHistory } from "./message-builder.js";
import { trimHistoryWithSummary } from "./utils/summarize.js";
import { generateInvocationId } from "./utils/id.js";
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
  stream(agentId: string, input: string, options: Omit<InvokeOptions, "stream"> = {}): InvokeStream {
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

      // ─── Run registry integration ──────────────────────────────────────
      const runRegistry = options.runRegistry;
      let runId = options.runId;
      let rootId: string | undefined;
      if (runRegistry) {
        if (!runId) {
          const root = runRegistry.create({
            agentId,
            input,
            parentRunId: options.parentRunId,
            userId: options.userId,
            sessionId: options.sessionId,
            spanEmitter: options.spanEmitter,
          });
          runId = root.id;
          rootId = root.rootId;
        } else {
          rootId = runRegistry.get(runId)?.rootId ?? runId;
        }
      }
      const ephemeralTools = new Map<string, ToolDefinition>();

      const modelConfig = {
        ...self.config.defaults?.model,
        ...agent.model,
        temperature: agent.model.temperature ?? self.config.defaults?.temperature,
        maxTokens: agent.model.maxTokens ?? self.config.defaults?.maxTokens,
      };
      const modelStr = `${modelConfig.provider}/${modelConfig.name}`;

      try {
        // Load session history
        let sessionHistory: Message[] = [];
        if (options.sessionId) {
          sessionHistory = await self.sessionStore.getMessages(options.sessionId);
          const maxMessages = self.config.session?.maxMessages ?? 50;
          const strategy = self.config.session?.strategy ?? "sliding";

          if (strategy === "summary" && sessionHistory.length > maxMessages) {
            sessionHistory = await trimHistoryWithSummary(sessionHistory, {
              maxMessages,
              modelProvider: self.modelProvider,
              modelConfig: modelConfig as import("./types.js").ModelConfig,
              signal: options.signal,
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

        const messages = buildMessages({
          agent,
          input,
          sessionHistory,
          contextEntries,
          extraContext: options.extraContext,
        });

        const availableTools = await self.resolveToolsForAgent(agent, {
          runRegistry,
          ephemeralTools,
        });

        const allToolCalls: ToolCallRecord[] = [];
        const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let finalOutput = "";
        let step = 0;

        const baseMaxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
        let inDrainPhase = false;
        let effectiveMaxSteps = baseMaxSteps;

        while (step < effectiveMaxSteps) {
          step++;

          if (options.signal?.aborted) {
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
              messages,
              tools: availableTools.length > 0 ? availableTools : undefined,
              outputSchema,
              signal: options.signal,
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
              messages,
              tools: availableTools.length > 0 ? availableTools : undefined,
              outputSchema,
              signal: options.signal,
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
                  await runRegistry.awaitNextSettled(runId, options.signal);
                }
                continue;
              }
            }
            finalOutput = resultText;
            break;
          }

          // Execute tool calls
          const stepToolCalls: ToolCallRecord[] = [];
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
              currentDepth,
            });

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
        }

        if (step >= effectiveMaxSteps && !finalOutput) {
          throw new MaxStepsExceededError(agentId, baseMaxSteps);
        }

        const duration = Date.now() - startTime;

        // Persist session
        if (options.sessionId) {
          const now = new Date().toISOString();
          await self.sessionStore.append(options.sessionId, [
            { role: "user", content: input, timestamp: now },
            {
              role: "assistant",
              content: finalOutput,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              timestamp: now,
            },
          ]);
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

        // Log
        await self.logStore.log({
          id: invocationId,
          agentId,
          sessionId: options.sessionId,
          input,
          output: finalOutput,
          toolCalls: allToolCalls,
          usage: totalUsage,
          duration,
          model: modelStr,
          timestamp: new Date().toISOString(),
        });

        const invokeResult: InvokeResult = {
          output: finalOutput,
          invocationId,
          toolCalls: allToolCalls,
          usage: totalUsage,
          duration,
          model: modelStr,
        };

        if (runRegistry && runId) {
          runRegistry.notifyCompleted(runId, invokeResult);
        }

        resolveResult!(invokeResult);
        yield { type: "done" as const, result: invokeResult };
      } catch (err) {
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
  async invoke(agentId: string, input: string, options: InvokeOptions = {}): Promise<InvokeResult> {
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

    // ─── Run registry integration ──────────────────────────────────────
    // If a registry is wired and there is no current Run id, materialize
    // one for this top-level call. Children always pass runId explicitly via
    // the spawn_agent tool, so this only fires for top-level invocations.
    const runRegistry = options.runRegistry;
    let runId = options.runId;
    let rootId: string | undefined;
    if (runRegistry) {
      if (!runId) {
        const root = runRegistry.create({
          agentId,
          input,
          parentRunId: options.parentRunId,
          userId: options.userId,
          sessionId: options.sessionId,
          spanEmitter: options.spanEmitter,
        });
        runId = root.id;
        rootId = root.rootId;
      } else {
        rootId = runRegistry.get(runId)?.rootId ?? runId;
      }
    }
    // Per-invocation ephemeral tools. spawn_agent/check_agents live here,
    // not in the global registry, because their schemas are agent-specific.
    const ephemeralTools = new Map<string, ToolDefinition>();

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

    // Start telemetry span
    const span = spanEmitter.startInvoke({
      agentId,
      invocationId,
      model: modelStr,
      ownerId: options.ownerId,
      sessionId: options.sessionId,
      contextIds: options.contextIds,
      input,
    });

    try {
      // Load session history
      let sessionHistory: Message[] = [];
      if (options.sessionId) {
        sessionHistory = await this.sessionStore.getMessages(options.sessionId);
        const maxMessages = this.config.session?.maxMessages ?? 50;
        const strategy = this.config.session?.strategy ?? "sliding";

        if (strategy === "summary" && sessionHistory.length > maxMessages) {
          sessionHistory = await trimHistoryWithSummary(sessionHistory, {
            maxMessages,
            modelProvider: this.modelProvider,
            modelConfig: modelConfig as import("./types.js").ModelConfig,
            signal: options.signal,
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

      // Build messages
      const messages = buildMessages({
        agent,
        input,
        sessionHistory,
        contextEntries,
        extraContext: options.extraContext,
      });

      // Resolve available tools for this agent (incl. spawn_agent/check_agents
      // when the agent declares `spawnable` and a runRegistry is provided).
      const availableTools = await this.resolveToolsForAgent(agent, {
        runRegistry,
        ephemeralTools,
      });

      // Execute the agent loop (model → tools → repeat)
      const allToolCalls: ToolCallRecord[] = [];
      const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let finalOutput = "";
      let step = 0;

      const baseMaxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
      let inDrainPhase = false;
      let effectiveMaxSteps = baseMaxSteps;

      while (step < effectiveMaxSteps) {
        step++;

        // Check for cancellation
        if (options.signal?.aborted) {
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
          // Call the model (with retry)
          result = await withRetry(
            () => this.modelProvider.generateText({
              model: modelConfig,
              messages,
              tools: availableTools.length > 0 ? availableTools : undefined,
              outputSchema,
              signal: options.signal,
            }),
            this.config.retry,
            options.signal,
          );

          const costUsd = computeCost(result.usage, modelConfig.provider, modelConfig.name);
          modelSpan.setResult({
            usage: result.usage,
            finishReason: result.finishReason,
            toolCallCount: result.toolCalls?.length ?? 0,
            costUsd: costUsd ?? undefined,
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
                await runRegistry.awaitNextSettled(runId, options.signal);
              }
              continue;
            }
          }
          finalOutput = result.text;
          break;
        }

        // Execute tool calls
        const toolResults: Array<{ id: string; result: string }> = [];

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
            currentDepth,
          });
          allToolCalls.push(record);

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

      // Save to session
      if (options.sessionId) {
        const now = new Date().toISOString();
        const newMessages: Message[] = [
          { role: "user", content: input, timestamp: now },
          {
            role: "assistant",
            content: finalOutput,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            timestamp: now,
          },
        ];
        await this.sessionStore.append(options.sessionId, newMessages);
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

      // Log the invocation
      const logEntry: InvocationLog = {
        id: invocationId,
        agentId,
        sessionId: options.sessionId,
        input,
        output: finalOutput,
        toolCalls: allToolCalls,
        usage: totalUsage,
        duration,
        model: modelStr,
        timestamp: new Date().toISOString(),
      };
      await this.logStore.log(logEntry);

      span.end();

      const invokeResult: InvokeResult = {
        output: finalOutput,
        invocationId,
        toolCalls: allToolCalls,
        usage: totalUsage,
        duration,
        model: modelStr,
      };

      if (runRegistry && runId) {
        runRegistry.notifyCompleted(runId, invokeResult);
      }

      return invokeResult;
    } catch (err) {
      span.error(err instanceof Error ? err : new Error(String(err)));
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
   * Take any queued child-Run completions for `runId` and append them as
   * synthetic "user" messages so the next model iteration can correlate
   * each `spawn_agent` handle with its result.
   *
   * Mutates `messages` in place. No-op if the registry queue is empty.
   */
  private injectPendingCompletions(
    registry: RunRegistry,
    runId: string,
    messages: Array<{ role: string; content: string }>,
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
    currentDepth: number;
  }): Promise<ToolCallRecord> {
    const {
      tc,
      agentId,
      options,
      invocationId,
      runId,
      runRegistry,
      ephemeralTools,
      currentDepth,
    } = params;

    const toolStartTime = Date.now();
    const toolCtx: ToolContext = {
      agentId,
      sessionId: options.sessionId,
      contextIds: options.contextIds,
      invocationId,
      runId,
      userId: options.userId,
      runRegistry,
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
   */
  private async resolveToolsForAgent(
    agent: AgentDefinition,
    opts?: {
      runRegistry?: RunRegistry;
      ephemeralTools?: Map<string, ToolDefinition>;
    },
  ): Promise<Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>> {
    const hasSpawnable =
      Boolean(agent.spawnable?.length) && Boolean(opts?.runRegistry) && Boolean(opts?.ephemeralTools);
    if (!agent.tools?.length && !hasSpawnable) return [];

    // Ensure every referenced MCP server is connected (resolving registered
    // connection names to urls/headers) before we ask for its tools.
    const mcpRefs = Array.from(
      new Set(
        (agent.tools ?? [])
          .filter((r): r is Extract<typeof r, { type: "mcp" }> => r.type === "mcp")
          .map((r) => r.server),
      ),
    );
    for (const ref of mcpRefs) {
      await this.ensureMCPServerRegistered(ref);
    }

    const resolved: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }> = [];

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

    return resolved;
  }

  /**
   * Lazily connect to an MCP server referenced by an agent. Looks up the ref
   * in the user's ConnectionStore (registered name → url/headers); falls back
   * to treating the ref as a URL. Keyed by the raw ref so resolveMCPTools can
   * look up tools by `entry.server` unchanged.
   */
  private async ensureMCPServerRegistered(ref: string): Promise<void> {
    if (!this.mcpManager) {
      this.mcpManager = new MCPClientManager({});
    }
    if (this.mcpManager.hasServer(ref)) return;

    const resolved = this._connectionStore
      ? await resolveMCPServerHelper(ref, this._connectionStore)
      : { url: ref, headers: undefined as Record<string, string> | undefined };

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
