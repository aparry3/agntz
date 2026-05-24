import type {
  AgentManifest,
  LLMAgentManifest,
  ManifestToolEntry,
  AgentRef as ManifestAgentRef,
} from "@agntz/manifest";
import type { AgentDefinition, AgentRef, ToolReference } from "@agntz/core";

/**
 * Convert a parsed agent manifest into the `AgentDefinition` shape the core
 * runner consumes. Supports LLM agents with all tool kinds the core engine
 * handles: local (resolved via the `tools` map passed to `agntz()`), HTTP
 * (state-templated headers/params with `{{env.X}}` / `{{secrets.X}}` refs),
 * MCP (lazy URL connection, no connection store required), and agent
 * (subagent invocation by id — target must also be loaded).
 *
 * `localToolNames` is the set of names supplied to the `tools` map at init
 * time. References to local tools not in this set raise an error here so
 * misconfigurations surface at load time, not at first model call.
 */
export function manifestToAgentDefinition(
  manifest: AgentManifest,
  localToolNames: Set<string>,
): AgentDefinition {
  if (manifest.kind !== "llm") {
    throw new Error(
      `Agent '${manifest.id}' has kind '${manifest.kind}' — only 'llm' agents are supported in @agntz/sdk today.`,
    );
  }
  return llmManifestToAgentDefinition(manifest, localToolNames);
}

function llmManifestToAgentDefinition(
  manifest: LLMAgentManifest,
  localToolNames: Set<string>,
): AgentDefinition {
  const tools: ToolReference[] = manifest.tools
    ? convertTools(manifest, manifest.tools, localToolNames)
    : [];

  if (manifest.skills && manifest.skills.length > 0) {
    throw new Error(
      `Agent '${manifest.id}' declares skills — not yet supported in @agntz/sdk (no SkillStore in embedded mode).`,
    );
  }

  return {
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    description: manifest.description,
    systemPrompt: manifest.instruction,
    userPromptTemplate: manifest.prompt,
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
    tools: tools.length > 0 ? tools : undefined,
    spawnable: manifest.spawnable
      ? convertSpawnable(manifest, manifest.spawnable, localToolNames)
      : undefined,
    reply: manifest.reply,
  };
}

function convertTools(
  manifest: LLMAgentManifest,
  entries: ManifestToolEntry[],
  localToolNames: Set<string>,
): ToolReference[] {
  const out: ToolReference[] = [];
  for (const entry of entries) {
    switch (entry.kind) {
      case "local":
        for (const name of entry.tools) {
          if (!localToolNames.has(name)) {
            throw new Error(
              `Agent '${manifest.id}' references local tool '${name}' but no handler was registered. Pass it in the \`tools\` map when calling \`agntz()\`.`,
            );
          }
          out.push({ type: "inline", name });
        }
        break;
      case "http":
        out.push({ type: "http", entry });
        break;
      case "mcp":
        out.push({
          type: "mcp",
          server: entry.server,
          tools: entry.tools
            ? entry.tools.map((t) => (typeof t === "string" ? t : t.tool))
            : undefined,
          headers: entry.headers,
        });
        break;
      case "agent":
        out.push({ type: "agent", agentId: entry.agent });
        break;
    }
  }
  return out;
}

function convertSpawnable(
  manifest: LLMAgentManifest,
  refs: ManifestAgentRef[],
  localToolNames: Set<string>,
): AgentRef[] {
  return refs.map((ref) => {
    if (ref.kind === "ref") {
      return ref.version
        ? { kind: "ref", agentId: ref.agentId, version: ref.version }
        : { kind: "ref", agentId: ref.agentId };
    }
    // Inline child — recursively convert as an LLM AgentDefinition. The
    // child's instruction is used verbatim as its systemPrompt (the manifest
    // validator already forbids template variables in inline-child
    // instructions).
    const childDef = llmManifestToAgentDefinition(ref.definition, localToolNames);
    return { kind: "inline", definition: childDef };
  });
}

function manifestSchemaToJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    properties[key] = typeof value === "string" ? { type: value } : enforceStrictObject(value);
    required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function enforceStrictObject(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...obj };

  if (obj.type === "object") {
    if (!("additionalProperties" in out)) out.additionalProperties = false;
    const props = obj.properties as Record<string, unknown> | undefined;
    if (props) {
      const walked: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(props)) {
        walked[key] = enforceStrictObject(child);
      }
      out.properties = walked;
    }
  }

  if (obj.type === "array" && obj.items) {
    out.items = enforceStrictObject(obj.items);
  }

  return out;
}
