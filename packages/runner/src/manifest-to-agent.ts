import type { AgentManifest, LLMAgentManifest, ManifestToolEntry } from "@agntz/manifest";
import type { AgentDefinition, ToolReference } from "@agntz/core";

/**
 * Convert a parsed agent manifest into the `AgentDefinition` shape the core
 * runner consumes. Phase 2 supports LLM agents with local + HTTP tools; other
 * kinds and MCP tools throw a clear "not supported in embedded mode" error
 * so users hit the failure at registration rather than at first invoke.
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
      `Agent '${manifest.id}' has kind '${manifest.kind}' — only 'llm' agents are supported in @agntz/runner today.`,
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

  if (manifest.spawnable && manifest.spawnable.length > 0) {
    throw new Error(
      `Agent '${manifest.id}' declares spawnable subagents — not yet supported in @agntz/runner.`,
    );
  }
  if (manifest.skills && manifest.skills.length > 0) {
    throw new Error(
      `Agent '${manifest.id}' declares skills — not yet supported in @agntz/runner.`,
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
    tools: tools.length > 0 ? tools : undefined,
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
        throw new Error(
          `Agent '${manifest.id}' uses MCP tools — not yet supported in @agntz/runner.`,
        );
      case "agent":
        throw new Error(
          `Agent '${manifest.id}' uses agent-as-tool references — not yet supported in @agntz/runner.`,
        );
    }
  }
  return out;
}
