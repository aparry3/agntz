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
  ModelProvider,
} from "./types.js";
import { ToolRegistry } from "./tool.js";
import { MemoryStore } from "./stores/memory.js";
import { AISDKModelProvider } from "./model-provider.js";
import { buildMessages, trimHistory } from "./message-builder.js";
import { generateInvocationId } from "./utils/id.js";
import { MCPClientManager } from "./mcp/client-manager.js";
import type { MCPTool } from "./mcp/client-manager.js";
import {
  AgentNotFoundError,
  InvocationCancelledError,
  MaxStepsExceededError,
  ToolExecutionError,
  ToolNotFoundError,
} from "./errors.js";
import { runEval } from "./eval.js";
import type { EvalRunOptions } from "./eval.js";

/** Maximum tool call iterations to prevent infinite loops */
const DEFAULT_MAX_STEPS = 10;

/**
 * The Runner. Central orchestrator for agent-runner.
 * Created via createRunner().
 */
export class Runner {
  private agentStore: AgentStore;
  private sessionStore: SessionStore;
  private contextStore: ContextStore;
  private logStore: LogStore;
  private modelProvider: ModelProvider;
  private toolRegistry: ToolRegistry;
  private mcpManager: MCPClientManager | null = null;
  private mcpInitPromise: Promise<void> | null = null;
  private config: RunnerConfig;

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

    // Model provider
    this.modelProvider = config.modelProvider ?? new AISDKModelProvider();

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
   */
  async shutdown(): Promise<void> {
    if (this.mcpManager) {
      await this.mcpManager.shutdown();
    }
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
   */
  stream(agentId: string, input: string, options: Omit<InvokeOptions, "stream"> = {}): InvokeStream {
    const self = this;
    let resolveResult: (r: InvokeResult) => void;
    const resultPromise = new Promise<InvokeResult>((resolve) => {
      resolveResult = resolve;
    });

    async function* generate(): AsyncGenerator<StreamEvent> {
      // Ensure MCP servers are connected
      await self.ensureMCPInitialized();

      const startTime = Date.now();
      const invocationId = generateInvocationId();
      const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
      const agent = await self.resolveAgent(agentId);

      const modelConfig = {
        ...self.config.defaults?.model,
        ...agent.model,
        temperature: agent.model.temperature ?? self.config.defaults?.temperature,
        maxTokens: agent.model.maxTokens ?? self.config.defaults?.maxTokens,
      };

      // Load session history
      let sessionHistory: Message[] = [];
      if (options.sessionId) {
        sessionHistory = await self.sessionStore.getMessages(options.sessionId);
        const maxMessages = self.config.session?.maxMessages ?? 50;
        sessionHistory = trimHistory(sessionHistory, maxMessages);
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

      const availableTools = self.resolveToolsForAgent(agent);
      const allToolCalls: ToolCallRecord[] = [];
      const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let finalOutput = "";
      let step = 0;

      while (step < maxSteps) {
        step++;

        if (options.signal?.aborted) {
          throw new InvocationCancelledError();
        }

        const outputSchema = agent.outputSchema
          ? { name: `${agent.id}_output`, schema: agent.outputSchema }
          : undefined;

        // Use streaming model call if available
        if (self.modelProvider.streamText) {
          const streamResult = await self.modelProvider.streamText({
            model: modelConfig,
            messages,
            tools: availableTools.length > 0 ? availableTools : undefined,
            outputSchema,
            signal: options.signal,
          });

          // Yield text deltas
          let fullText = "";
          for await (const chunk of streamResult.textStream) {
            fullText += chunk;
            yield { type: "text-delta" as const, text: chunk };
          }

          const toolCalls = await streamResult.toolCalls;
          const usage = await streamResult.usage;

          totalUsage.promptTokens += usage.promptTokens;
          totalUsage.completionTokens += usage.completionTokens;
          totalUsage.totalTokens += usage.totalTokens;

          if (!toolCalls?.length) {
            finalOutput = fullText;
            break;
          }

          // Handle tool calls
          const stepToolCalls: ToolCallRecord[] = [];
          for (const tc of toolCalls) {
            yield { type: "tool-call-start" as const, toolCall: { id: tc.id, name: tc.name } };

            const toolStartTime = Date.now();
            const toolCtx: ToolContext = {
              agentId,
              sessionId: options.sessionId,
              contextIds: options.contextIds,
              invocationId,
              invoke: (aid: string, inp: string, opts?: InvokeOptions) => self.invoke(aid, inp, opts),
              ...(options.toolContext ?? {}),
            };

            let output: unknown;
            let error: string | undefined;
            try {
              output = await self.toolRegistry.execute(tc.name, tc.args, toolCtx);
            } catch (err) {
              error = err instanceof Error ? err.message : String(err);
              output = { error };
            }

            const record: ToolCallRecord = {
              id: tc.id, name: tc.name, input: tc.args,
              output, duration: Date.now() - toolStartTime, error,
            };
            stepToolCalls.push(record);
            allToolCalls.push(record);

            yield { type: "tool-call-end" as const, toolCall: record };
          }

          yield { type: "step-complete" as const, step, toolCalls: stepToolCalls };

          // Add to conversation for next step
          if (fullText) {
            messages.push({ role: "assistant", content: fullText });
          }
          messages.push({
            role: "assistant",
            content: toolCalls.map(tc => `[Tool Call: ${tc.name}(${JSON.stringify(tc.args)})]`).join("\n"),
          });
          for (const tc of stepToolCalls) {
            messages.push({
              role: "tool" as string,
              content: typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output),
            });
          }
        } else {
          // Fallback to non-streaming
          const result = await self.modelProvider.generateText({
            model: modelConfig,
            messages,
            tools: availableTools.length > 0 ? availableTools : undefined,
            outputSchema,
            signal: options.signal,
          });

          totalUsage.promptTokens += result.usage.promptTokens;
          totalUsage.completionTokens += result.usage.completionTokens;
          totalUsage.totalTokens += result.usage.totalTokens;

          if (!result.toolCalls?.length) {
            finalOutput = result.text;
            yield { type: "text-delta" as const, text: result.text };
            break;
          }

          // Execute tools (same as non-streaming path)
          const stepToolCalls: ToolCallRecord[] = [];
          for (const tc of result.toolCalls) {
            yield { type: "tool-call-start" as const, toolCall: { id: tc.id, name: tc.name } };

            const toolStartTime = Date.now();
            const toolCtx: ToolContext = {
              agentId,
              sessionId: options.sessionId,
              contextIds: options.contextIds,
              invocationId,
              invoke: (aid: string, inp: string, opts?: InvokeOptions) => self.invoke(aid, inp, opts),
              ...(options.toolContext ?? {}),
            };

            let output: unknown;
            let error: string | undefined;
            try {
              output = await self.toolRegistry.execute(tc.name, tc.args, toolCtx);
            } catch (err) {
              error = err instanceof Error ? err.message : String(err);
              output = { error };
            }

            const record: ToolCallRecord = {
              id: tc.id, name: tc.name, input: tc.args,
              output, duration: Date.now() - toolStartTime, error,
            };
            stepToolCalls.push(record);
            allToolCalls.push(record);

            yield { type: "tool-call-end" as const, toolCall: record };
          }

          yield { type: "step-complete" as const, step, toolCalls: stepToolCalls };

          if (result.text) messages.push({ role: "assistant", content: result.text });
          messages.push({
            role: "assistant",
            content: result.toolCalls.map(tc => `[Tool Call: ${tc.name}(${JSON.stringify(tc.args)})]`).join("\n"),
          });
          for (const tc of stepToolCalls) {
            messages.push({
              role: "tool" as string,
              content: typeof tc.output === "string" ? tc.output : JSON.stringify(tc.output),
            });
          }

          if (result.finishReason === "stop" && result.text) {
            finalOutput = result.text;
            break;
          }
        }
      }

      if (step >= maxSteps && !finalOutput) {
        throw new MaxStepsExceededError(agentId, maxSteps);
      }

      const duration = Date.now() - startTime;
      const modelStr = `${modelConfig.provider}/${modelConfig.name}`;

      // Persist session
      if (options.sessionId) {
        const now = new Date().toISOString();
        await self.sessionStore.append(options.sessionId, [
          { role: "user", content: input, timestamp: now },
          { role: "assistant", content: finalOutput, toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined, timestamp: now },
        ]);
      }

      // Context write
      if (agent.contextWrite && options.contextIds?.length && finalOutput) {
        for (const contextId of options.contextIds) {
          await self.contextStore.addContext(contextId, {
            contextId, agentId, invocationId, content: finalOutput, createdAt: new Date().toISOString(),
          });
        }
      }

      // Log
      await self.logStore.log({
        id: invocationId, agentId, sessionId: options.sessionId,
        input, output: finalOutput, toolCalls: allToolCalls,
        usage: totalUsage, duration, model: modelStr, timestamp: new Date().toISOString(),
      });

      const invokeResult: InvokeResult = {
        output: finalOutput, invocationId, toolCalls: allToolCalls,
        usage: totalUsage, duration, model: modelStr,
      };

      resolveResult!(invokeResult);
      yield { type: "done" as const, result: invokeResult };
    }

    const iterable = generate();
    return {
      [Symbol.asyncIterator]() { return iterable; },
      result: resultPromise,
    };
  }

  /**
   * Invoke an agent. This is the main entry point for running an agent.
   */
  async invoke(agentId: string, input: string, options: InvokeOptions = {}): Promise<InvokeResult> {
    // Ensure MCP servers are connected before resolving tools
    await this.ensureMCPInitialized();

    const startTime = Date.now();
    const invocationId = generateInvocationId();
    const agent = await this.resolveAgent(agentId);

    // Resolve model config (agent model or defaults)
    const modelConfig = {
      ...this.config.defaults?.model,
      ...agent.model,
      temperature: agent.model.temperature ?? this.config.defaults?.temperature,
      maxTokens: agent.model.maxTokens ?? this.config.defaults?.maxTokens,
    };

    // Load session history
    let sessionHistory: Message[] = [];
    if (options.sessionId) {
      sessionHistory = await this.sessionStore.getMessages(options.sessionId);
      const maxMessages = this.config.session?.maxMessages ?? 50;
      sessionHistory = trimHistory(sessionHistory, maxMessages);
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

    // Resolve available tools for this agent
    const availableTools = this.resolveToolsForAgent(agent);

    // Execute the agent loop (model → tools → repeat)
    const allToolCalls: ToolCallRecord[] = [];
    const totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let finalOutput = "";
    let step = 0;

    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

    while (step < maxSteps) {
      step++;

      // Check for cancellation
      if (options.signal?.aborted) {
        throw new InvocationCancelledError();
      }

      // Build output schema if the agent defines one
      const outputSchema = agent.outputSchema
        ? { name: `${agent.id}_output`, schema: agent.outputSchema }
        : undefined;

      // Call the model
      const result = await this.modelProvider.generateText({
        model: modelConfig,
        messages,
        tools: availableTools.length > 0 ? availableTools : undefined,
        outputSchema,
        signal: options.signal,
      });

      // Accumulate usage
      totalUsage.promptTokens += result.usage.promptTokens;
      totalUsage.completionTokens += result.usage.completionTokens;
      totalUsage.totalTokens += result.usage.totalTokens;

      // If no tool calls, we're done
      if (!result.toolCalls?.length) {
        finalOutput = result.text;
        break;
      }

      // Execute tool calls
      const toolResults: Array<{ id: string; result: string }> = [];

      for (const tc of result.toolCalls) {
        const toolStartTime = Date.now();
        const toolCtx: ToolContext = {
          agentId,
          sessionId: options.sessionId,
          contextIds: options.contextIds,
          invocationId,
          invoke: (agentId: string, input: string, opts?: InvokeOptions) =>
            this.invoke(agentId, input, opts),
          ...(options.toolContext ?? {}),
        };

        let output: unknown;
        let error: string | undefined;

        try {
          output = await this.toolRegistry.execute(tc.name, tc.args, toolCtx);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          output = { error };
        }

        const toolCallRecord: ToolCallRecord = {
          id: tc.id,
          name: tc.name,
          input: tc.args,
          output,
          duration: Date.now() - toolStartTime,
          error,
        };
        allToolCalls.push(toolCallRecord);

        toolResults.push({
          id: tc.id,
          result: typeof output === "string" ? output : JSON.stringify(output),
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
    const modelStr = `${modelConfig.provider}/${modelConfig.name}`;

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

    return {
      output: finalOutput,
      invocationId,
      toolCalls: allToolCalls,
      usage: totalUsage,
      duration,
      model: modelStr,
    };
  }

  /**
   * Resolve the tools available to an agent based on its tools[] references.
   * Returns tool metadata for the model AND registers ephemeral tools
   * in the registry so they can be executed during the invoke loop.
   */
  private resolveToolsForAgent(agent: AgentDefinition): Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> {
    if (!agent.tools?.length) return [];

    const resolved: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }> = [];

    for (const ref of agent.tools) {
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

    return resolved;
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

    const agentTool: ToolDefinition = {
      name: toolName,
      description,
      input: z.object({
        input: z.string().describe("The input/question to send to the agent"),
      }),
      async execute(input: { input: string }, ctx: ToolContext) {
        const result = await ctx.invoke(agentId, input.input);
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
 * Create a runner instance. This is the primary entry point for agent-runner.
 */
export function createRunner(config: RunnerConfig = {}): Runner {
  return new Runner(config);
}
