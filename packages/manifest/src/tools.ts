import type { AgentState, ManifestToolEntry, MCPToolEntry, WrappedToolRef } from "./types.js";
import { interpolate } from "./template.js";

/**
 * Represents a tool as seen by the LLM — potentially modified by wrapping.
 */
export interface ResolvedTool {
  /** The name the LLM sees (may be overridden) */
  name: string;
  /** The description the LLM sees (may be overridden) */
  description?: string;
  /** The original tool name on the MCP server */
  originalName: string;
  /** MCP server URL (if MCP tool) */
  server?: string;
  /** Source kind */
  source: "mcp" | "local" | "agent";
  /** Agent ID (if agent tool) */
  agentId?: string;
  /** Parameters pinned from state (hidden from LLM) */
  pinnedParams?: Record<string, string>;
}

/**
 * Resolve tool entries from a manifest into ResolvedTool instances.
 * Handles wrapping: pinned params, name/description overrides.
 */
export function resolveToolEntries(entries: ManifestToolEntry[]): ResolvedTool[] {
  const resolved: ResolvedTool[] = [];

  for (const entry of entries) {
    switch (entry.kind) {
      case "mcp":
        resolved.push(...resolveMCPEntry(entry));
        break;
      case "local":
        for (const name of entry.tools) {
          resolved.push({
            name,
            originalName: name,
            source: "local",
          });
        }
        break;
      case "agent":
        resolved.push({
          name: entry.agent,
          originalName: entry.agent,
          source: "agent",
          agentId: entry.agent,
        });
        break;
    }
  }

  return resolved;
}

function resolveMCPEntry(entry: MCPToolEntry): ResolvedTool[] {
  if (!entry.tools) {
    // No tools specified — expose all from server (resolved at runtime)
    return [{
      name: `*:${entry.server}`,
      originalName: "*",
      server: entry.server,
      source: "mcp",
    }];
  }

  return entry.tools.map((ref) => {
    if (typeof ref === "string") {
      return {
        name: ref,
        originalName: ref,
        server: entry.server,
        source: "mcp" as const,
      };
    }

    // Wrapped tool
    return {
      name: ref.name ?? ref.tool,
      description: ref.description,
      originalName: ref.tool,
      server: entry.server,
      source: "mcp" as const,
      pinnedParams: ref.params,
    };
  });
}

/**
 * Build the tool execution params: merge LLM-provided args with pinned params
 * resolved from state.
 */
export function buildToolParams(
  tool: ResolvedTool,
  llmArgs: Record<string, unknown>,
  state: AgentState
): Record<string, unknown> {
  const params = { ...llmArgs };

  if (tool.pinnedParams) {
    for (const [key, template] of Object.entries(tool.pinnedParams)) {
      params[key] = interpolate(template, state);
    }
  }

  return params;
}

/**
 * Modify a tool's JSON Schema to remove pinned params.
 * Returns a new schema with the pinned param properties removed.
 */
export function stripPinnedParams(
  schema: Record<string, unknown>,
  pinnedParams: Record<string, string>
): Record<string, unknown> {
  const result = structuredClone(schema);
  const properties = result.properties as Record<string, unknown> | undefined;
  if (!properties) return result;

  for (const key of Object.keys(pinnedParams)) {
    delete properties[key];
  }

  // Also remove from required array if present
  if (Array.isArray(result.required)) {
    result.required = (result.required as string[]).filter(
      (r) => !(r in pinnedParams)
    );
  }

  return result;
}
