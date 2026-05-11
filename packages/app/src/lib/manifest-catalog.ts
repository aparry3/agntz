export const AGENT_KINDS = ["llm", "tool", "sequential", "parallel"] as const;
export type AgentKindOption = (typeof AGENT_KINDS)[number];

export const TOOL_ENTRY_KINDS = ["local", "mcp", "agent"] as const;
export type ToolEntryKind = (typeof TOOL_ENTRY_KINDS)[number];

export const SPAWNABLE_KINDS = ["ref", "inline"] as const;
export type SpawnableKind = (typeof SPAWNABLE_KINDS)[number];

export const PROPERTY_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
