import type { Runner, AgentDefinition, AgentRef as CoreAgentRef, RunRegistry } from "@agntz/core";
import type {
  ExecutionContext,
  AgentManifest,
  AgentRef,
  LLMAgentManifest,
  ToolCallConfig,
  AgentState,
} from "@agntz/manifest";
import { parseManifest } from "@agntz/manifest";

export interface CreateExecutionContextOptions {
  /**
   * Per-request RunRegistry. When provided, LLM invocations receive it
   * via `InvokeOptions.runRegistry` so that any `spawnable` agents can
   * synthesize the `spawn_agent` / `check_agents` tools and create child
   * Runs. Without a registry, spawn tools are not registered and any
   * `spawn_agent` call would fail at runtime.
   */
  runRegistry?: RunRegistry;

  /** Per-request span emitter. Forwarded to runner.invoke so the executor
   *  and runner share the same trace stack. */
  spanEmitter?: import("@agntz/core").SpanEmitter;

  /** Tenant scoping. Threaded into ExecutionContext and span metadata. */
  ownerId?: string;
}

/**
 * Create an ExecutionContext that bridges the manifest engine to the core Runner.
 *
 * This is how YAML-defined agents execute: the manifest engine handles orchestration
 * (pipelines, state, conditions), and delegates actual LLM/tool calls to the Runner.
 */
export function createExecutionContext(
  runner: Runner,
  options: CreateExecutionContextOptions = {},
): ExecutionContext {
  const { runRegistry, spanEmitter, ownerId } = options;
  return {
    spanEmitter,
    ownerId,
    resolveAgent: async (id: string) => {
      const agentDef = await runner.agents.getAgent(id);
      if (!agentDef) {
        throw new Error(`Agent "${id}" not found`);
      }
      // Agent definitions stored in the DB may have a `manifest` field (YAML string)
      // or may already be a parsed manifest object stored as metadata
      const manifest = resolveManifestFromAgent(agentDef as unknown as Record<string, unknown>);
      return manifest;
    },

    invokeLLM: async (manifest: LLMAgentManifest, renderedInstruction: string, state: AgentState) => {
      // For ref-kind spawnable children, the agent store only holds a placeholder
      // AgentDefinition (real config lives in metadata.manifest). Pre-register
      // each ref child as a real AgentDefinition under its actual id so that
      // when the LLM calls spawn_agent, runner.invoke(child_id) resolves to a
      // working definition. Inline children are translated below and registered
      // by the runner's own resolveSpawnable path.
      if (manifest.spawnable && runRegistry) {
        await preregisterSpawnableRefs(runner, manifest.spawnable);
      }

      // Build a temporary agent definition for the core runner
      const agentDef = manifestToAgentDefinition(manifest, renderedInstruction);

      // Register it temporarily (or use inline invoke)
      const tempId = `__temp_${manifest.id}_${Date.now()}`;
      agentDef.id = tempId;
      runner.registerAgent(agentDef as AgentDefinition);

      const hasSchema = Boolean(manifest.outputSchema);
      const start = Date.now();
      console.log(
        `[llm] ${manifest.id} start ` +
        `model=${manifest.model.provider}/${manifest.model.name} ` +
        `instr=${renderedInstruction.length}ch schema=${hasSchema} ` +
        `spawnable=${manifest.spawnable?.length ?? 0}`
      );

      try {
        // Build user input from state
        const userInput = state.userQuery
          ? String(state.userQuery)
          : JSON.stringify(state);

        const result = await runner.invoke(tempId, userInput, {
          ...(runRegistry ? { runRegistry } : {}),
          ...(spanEmitter ? { spanEmitter } : {}),
        });
        const duration = Date.now() - start;

        // If outputSchema is defined, try to parse structured output
        if (hasSchema) {
          try {
            const parsed = JSON.parse(result.output);
            console.log(
              `[llm] ${manifest.id} done ${duration}ms ` +
              `out=${result.output.length}ch parsed keys=[${Object.keys(parsed).join(",")}]`
            );
            return parsed;
          } catch (err) {
            console.warn(
              `[llm] ${manifest.id} done ${duration}ms ` +
              `out=${result.output.length}ch PARSE FAILED (${(err as Error).message}) — returning raw text`
            );
            return result.output;
          }
        }

        console.log(`[llm] ${manifest.id} done ${duration}ms out=${result.output.length}ch`);
        return result.output;
      } catch (err) {
        const duration = Date.now() - start;
        console.error(`[llm] ${manifest.id} failed ${duration}ms: ${(err as Error).message}`);
        throw err;
      } finally {
        // Clean up temp agent
        await runner.agents.deleteAgent(tempId).catch(() => {});
      }
    },

    invokeTool: async (config: ToolCallConfig, state: AgentState) => {
      // Resolve the tool name (MCP tools are namespaced as "serverName:toolName")
      const toolName = config.kind === "mcp" && config.server
        ? `${config.server}:${config.name}`
        : config.name;

      // The params are already resolved from state by the tool executor
      const input = config.params ?? {};

      const start = Date.now();
      console.log(`[tool] ${toolName} start params=${JSON.stringify(input).slice(0, 200)}`);
      try {
        const result = await runner.tools.execute(toolName, input);
        console.log(`[tool] ${toolName} done ${Date.now() - start}ms`);
        return result;
      } catch (err) {
        console.error(`[tool] ${toolName} failed ${Date.now() - start}ms: ${(err as Error).message}`);
        throw err;
      }
    },
  };
}

/**
 * Convert a stored AgentDefinition into an AgentManifest.
 * The agent's metadata.manifest field holds the YAML source.
 */
function resolveManifestFromAgent(agentDef: Record<string, unknown>): AgentManifest {
  // If metadata contains the raw YAML manifest
  const metadata = agentDef.metadata as Record<string, unknown> | undefined;
  if (metadata?.manifest && typeof metadata.manifest === "string") {
    return parseManifest(metadata.manifest);
  }

  // If metadata contains a pre-parsed manifest object
  if (metadata?.parsedManifest) {
    return metadata.parsedManifest as AgentManifest;
  }

  // Fallback: try to construct from the agent definition itself
  throw new Error(
    `Agent "${agentDef.id}" does not have a manifest. Store agents with metadata.manifest (YAML string).`
  );
}

/**
 * Convert a LLMAgentManifest into a core AgentDefinition for the Runner.
 */
function manifestToAgentDefinition(manifest: LLMAgentManifest, renderedInstruction: string) {
  return {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    systemPrompt: renderedInstruction,
    model: {
      provider: manifest.model.provider,
      name: manifest.model.name,
      temperature: manifest.model.temperature,
      maxTokens: manifest.model.maxTokens,
      topP: manifest.model.topP,
    },
    examples: manifest.examples,
    outputSchema: manifest.outputSchema
      ? manifestSchemaToJsonSchema(manifest.outputSchema)
      : undefined,
    tools: manifest.tools
      ? manifestToolsToToolRefs(manifest.tools)
      : undefined,
    spawnable: manifest.spawnable
      ? manifestSpawnableToCore(manifest.spawnable)
      : undefined,
  };
}

/**
 * Translate manifest-layer AgentRef[] (with inline LLMAgentManifest) into the
 * core AgentRef[] shape (with inline AgentDefinition). Inline children are
 * registered by the runner's own resolveSpawnable path; we just give them the
 * shape it expects. Ref children pass through unchanged.
 */
function manifestSpawnableToCore(spawnable: AgentRef[]): CoreAgentRef[] {
  return spawnable.map((ref) => {
    if (ref.kind === "ref") return { kind: "ref", agentId: ref.agentId };
    // Inline LLM children: validator forbids template variables in the
    // instruction, so we use it verbatim as the systemPrompt.
    return {
      kind: "inline",
      definition: manifestToAgentDefinition(ref.definition, ref.definition.instruction) as AgentDefinition,
    };
  });
}

/**
 * Pre-register each ref-kind spawnable child as a working AgentDefinition
 * under its real id, sourcing config from the child's stored YAML manifest.
 * Required because the app stores agents with a placeholder AgentDefinition
 * (real config lives in metadata.manifest) — the runner's `resolveAgent`
 * would otherwise hand spawn_agent an empty systemPrompt.
 *
 * Children must be LLM-kind manifests with non-templated instructions (the
 * validator enforces this for inline children; ref children whose stored
 * manifest violates it are skipped here with a console warning rather than
 * surfaced to the parent invocation).
 */
async function preregisterSpawnableRefs(
  runner: Runner,
  spawnable: AgentRef[],
): Promise<void> {
  for (const ref of spawnable) {
    if (ref.kind !== "ref") continue;
    const stored = await runner.agents.getAgent(ref.agentId);
    if (!stored) {
      console.warn(`[spawn] skip ref '${ref.agentId}': not in agent store`);
      continue;
    }
    let childManifest: AgentManifest;
    try {
      childManifest = resolveManifestFromAgent(stored as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn(`[spawn] skip ref '${ref.agentId}': ${(err as Error).message}`);
      continue;
    }
    if (childManifest.kind !== "llm") {
      console.warn(`[spawn] skip ref '${ref.agentId}': only llm-kind children supported (got ${childManifest.kind})`);
      continue;
    }
    if (/\{\{[^}]+\}\}/.test(childManifest.instruction)) {
      console.warn(
        `[spawn] skip ref '${ref.agentId}': instruction contains template variables; ` +
        `spawn callbacks pre-register children with static systemPrompts`,
      );
      continue;
    }
    const def = manifestToAgentDefinition(childManifest, childManifest.instruction) as AgentDefinition;
    runner.registerAgent(def);
  }
}

/**
 * Convert the flat manifest outputSchema to a proper JSON Schema.
 */
function manifestSchemaToJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === "string") {
      properties[key] = { type: value };
    } else {
      properties[key] = enforceStrictObject(value);
    }
    required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * OpenAI strict structured output requires `additionalProperties: false` on every
 * nested object schema. Walk the schema and enforce it.
 */
function enforceStrictObject(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };

  if (obj.type === "object") {
    if (!("additionalProperties" in out)) out.additionalProperties = false;
    const props = obj.properties as Record<string, unknown> | undefined;
    if (props) {
      const walked: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) walked[k] = enforceStrictObject(v);
      out.properties = walked;
    }
  }
  if (obj.type === "array" && obj.items) {
    out.items = enforceStrictObject(obj.items);
  }
  return out;
}

/**
 * Convert manifest tool entries to core ToolReference format.
 */
function manifestToolsToToolRefs(tools: LLMAgentManifest["tools"]) {
  if (!tools) return [];

  const refs: Array<Record<string, unknown>> = [];
  for (const entry of tools) {
    switch (entry.kind) {
      case "mcp":
        refs.push({
          type: "mcp",
          server: entry.server,
          tools: entry.tools
            ? entry.tools.map((t) => (typeof t === "string" ? t : t.tool))
            : undefined,
        });
        break;
      case "local":
        for (const name of entry.tools) {
          refs.push({ type: "inline", name });
        }
        break;
      case "agent":
        refs.push({ type: "agent", agentId: entry.agent });
        break;
    }
  }
  return refs;
}
