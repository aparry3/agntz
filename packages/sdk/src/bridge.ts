import type {
  AgentManifest,
  AgentState,
  ExecutionContext,
  LLMAgentManifest,
  ToolCallConfig,
} from "@agntz/manifest";
import { buildHttpToolDefinition } from "@agntz/core";
import type { Runner, SpanEmitter, ToolDefinition, ToolContext, Reply } from "@agntz/core";
import { manifestToAgentDefinition } from "./manifest-to-agent.js";

export interface CreateExecutionContextOptions {
  spanEmitter?: SpanEmitter;
  sessionId?: string;
  context?: string[];
  signal?: AbortSignal;
  /**
   * Local-tool implementations registered with `agntz({ tools: ... })`.
   * Used by `invokeTool` to dispatch `kind: local` pipeline tool steps
   * without round-tripping through the LLM-only tool registry.
   */
  localTools?: Map<string, ToolDefinition>;
  /**
   * Collects intermediate `reply` tool messages emitted by LLM sub-steps
   * inside a manifest pipeline. The top-level `.agents.run` aggregates
   * these onto the returned `RunResult.replies`.
   */
  replyCollector?: Reply[];
}

/**
 * Build the `ExecutionContext` the `@agntz/manifest` executor needs to
 * dispatch across all four agent kinds. Mirrors `packages/worker/src/bridge.ts`
 * but trimmed for single-tenant embedded use:
 *
 *  - No run-registry / multi-Run orchestration (one invocation = one Run)
 *  - No user scoping (single-process, single-tenant)
 *  - resolveAgent reads from the runner's in-memory registered map
 */
export function createExecutionContext(
  runner: Runner,
  manifests: ReadonlyMap<string, AgentManifest>,
  localToolNames: Set<string>,
  opts: CreateExecutionContextOptions = {},
): ExecutionContext {
  const context = normalizeLocalNamespaceGrants(opts.context);
  return {
    spanEmitter: opts.spanEmitter,
    resolveAgent: async (id: string) => {
      const manifest = manifests.get(id);
      if (!manifest) throw new Error(`Agent "${id}" not loaded from agents directory`);
      return manifest;
    },

    invokeLLM: async (
      manifest: LLMAgentManifest,
      renderedInstruction: string,
      renderedPrompt: string | undefined,
      state: AgentState,
    ) => {
      // The executor has pre-rendered the instruction with full state. The
      // core runner expects a static systemPrompt, so we synthesize a
      // temp agent under a unique id with the rendered instruction baked in,
      // invoke, then deregister. Same pattern as the hosted worker bridge.
      const tempId = `__pipeline_${manifest.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const def = manifestToAgentDefinition({ ...manifest, instruction: renderedInstruction }, localToolNames);
      def.id = tempId;
      def.userPromptTemplate = undefined; // we pass the rendered user message ourselves
      runner.registerAgent(def);

      try {
        const userInput = renderedPrompt
          ?? (state.userQuery != null ? String(state.userQuery) : JSON.stringify(state));
        const result = await runner.invoke(tempId, userInput, {
          ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
          context,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.spanEmitter ? { spanEmitter: opts.spanEmitter } : {}),
        });
        if (opts.replyCollector && result.replies?.length) {
          opts.replyCollector.push(...result.replies);
        }
        // For LLM steps with an outputSchema, try to JSON-parse so downstream
        // pipeline steps see structured fields rather than a string blob.
        if (manifest.outputSchema) {
          try {
            return JSON.parse(result.output);
          } catch {
            return result.output;
          }
        }
        return result.output;
      } finally {
        runner.deregisterAgent(tempId);
      }
    },

    invokeTool: async (config: ToolCallConfig, state: AgentState) => {
      switch (config.kind) {
        case "local": {
          const tool = opts.localTools?.get(config.name);
          if (!tool) {
            throw new Error(
              `Pipeline tool step references local tool '${config.name}' but no handler was registered.`,
            );
          }
          const ctx = makeDirectToolContext(runner, config.name, context);
          return tool.execute(config.params ?? {}, ctx);
        }
        case "http": {
          if (!config.url) throw new Error("HTTP pipeline tool config missing 'url'");
          // The tool's execute closes over state so secrets/env refs are
          // resolved at call time using the runner's pre-fetched values.
          const tool = buildHttpToolDefinition(
            {
              kind: "http",
              name: config.name,
              url: config.url,
              method: config.method,
              description: config.description,
              params: config.params,
              headers: config.headers,
              body_type: config.body_type,
              body: config.body,
              auth: config.auth,
            },
            state,
            { tokenResolver: runner.tokenResolver, tokenCache: runner.tokenCache },
          );
          return (tool.execute as (a: unknown, c: ToolContext) => Promise<unknown>)(
            {},
            makeDirectToolContext(runner, `http__${config.name}`, context),
          );
        }
        case "mcp": {
          // MCP tools are registered in the runner's tool registry on first
          // resolution (via the runner's MCP manager). Route through the
          // public tools.execute API, namespacing the tool name with the
          // server so the registry finds the right adapter.
          const toolName = config.server ? `${config.server}:${config.name}` : config.name;
          return runner.tools.execute(toolName, config.params ?? {});
        }
      }
    },
  };
}

function makeDirectToolContext(runner: Runner, agentId: string, context: string[]): ToolContext {
  return {
    agentId,
    context,
    invocationId: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    invoke: (id, input, options) =>
      runner.invoke(id, input, {
        ...options,
        context: narrowLocalNamespaceGrants(context, options?.context),
      }),
  };
}

function normalizeLocalNamespaceGrants(input: readonly string[] | undefined): string[] {
  if (input === undefined) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string" || raw.length === 0) {
      throw new Error("Invalid namespace grant: grant must be a non-empty string");
    }
    if (raw.trim() !== raw || raw.startsWith("/") || raw.endsWith("/") || raw.includes("//")) {
      throw new Error(`Invalid namespace grant "${raw}"`);
    }
    for (const segment of raw.split("/")) {
      if (segment === "." || segment === ".." || segment.includes("*") || /\s/.test(segment)) {
        throw new Error(`Invalid namespace grant "${raw}"`);
      }
    }
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

function narrowLocalNamespaceGrants(
  parent: readonly string[],
  requested: readonly string[] | undefined,
): string[] {
  if (requested === undefined) return [...parent];
  const normalized = normalizeLocalNamespaceGrants(requested);
  for (const grant of normalized) {
    if (!parent.some((p) => grant === p || grant.startsWith(`${p}/`))) {
      throw new Error(`Invalid namespace grant "${grant}": grant is not within parent context [${parent.join(", ")}]`);
    }
  }
  return normalized;
}
