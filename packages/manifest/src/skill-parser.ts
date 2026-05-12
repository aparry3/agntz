import { parse as parseYAML } from "yaml";
import type { SkillDefinition, ToolReference } from "@agntz/core";
import type { ManifestToolEntry, MCPToolRef } from "./types.js";

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

// Parse a skill YAML string into a SkillDefinition.
export function parseSkill(yaml: string): SkillDefinition {
  const raw = parseYAML(yaml);
  if (!raw || typeof raw !== "object") {
    throw new Error("Skill YAML must be an object");
  }
  return normalizeSkill(raw as Record<string, unknown>);
}

// Normalize a raw parsed object into a typed SkillDefinition.
export function normalizeSkill(raw: Record<string, unknown>): SkillDefinition {
  const name = requireString(raw, "name");
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(`Skill name '${name}' must match ${SKILL_NAME_RE.source}`);
  }
  const description = requireString(raw, "description");
  const instructions = requireString(raw, "instructions");

  const tools = raw.tools
    ? normalizeSkillTools(raw.tools as unknown[])
    : undefined;

  const out: SkillDefinition = { name, description, instructions };
  if (tools && tools.length > 0) out.tools = tools;
  if (raw.metadata && typeof raw.metadata === "object") {
    out.metadata = raw.metadata as Record<string, unknown>;
  }
  if (typeof raw.createdAt === "string") out.createdAt = raw.createdAt;
  if (typeof raw.updatedAt === "string") out.updatedAt = raw.updatedAt;
  return out;
}

// Convert a single manifest `tools:` entry to one or more runner ToolReferences.
export function manifestEntryToToolReferences(entry: ManifestToolEntry): ToolReference[] {
  switch (entry.kind) {
    case "local":
      return (entry.tools ?? []).map((name) => ({ type: "inline" as const, name }));
    case "mcp": {
      const tools = entry.tools && entry.tools.length > 0 ? entry.tools.map(toolNameOfRef) : undefined;
      const ref: ToolReference = tools
        ? { type: "mcp", server: entry.server, tools }
        : { type: "mcp", server: entry.server };
      return [ref];
    }
    case "agent":
      return [{ type: "agent", agentId: entry.agent }];
  }
}

function toolNameOfRef(ref: MCPToolRef): string {
  return typeof ref === "string" ? ref : ref.tool;
}

function normalizeSkillTools(raw: unknown[]): ToolReference[] {
  if (!Array.isArray(raw)) {
    throw new Error("Skill 'tools' must be an array");
  }
  const refs: ToolReference[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = parseManifestToolEntry(raw[i], i);
    refs.push(...manifestEntryToToolReferences(entry));
  }
  return refs;
}

function parseManifestToolEntry(raw: unknown, idx: number): ManifestToolEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`tools[${idx}] must be an object with a 'kind' field`);
  }
  const e = raw as Record<string, unknown>;
  const kind = e.kind as string;
  switch (kind) {
    case "mcp":
      return {
        kind: "mcp",
        server: requireString(e, "server"),
        tools: e.tools ? normalizeMCPToolRefs(e.tools as unknown[], idx) : undefined,
      };
    case "local":
      if (!Array.isArray(e.tools)) {
        throw new Error(`tools[${idx}].tools must be an array of tool name strings`);
      }
      return { kind: "local", tools: e.tools as string[] };
    case "agent":
      return { kind: "agent", agent: requireString(e, "agent") };
    default:
      throw new Error(`tools[${idx}].kind must be 'mcp' | 'local' | 'agent' (got '${kind}')`);
  }
}

function normalizeMCPToolRefs(raw: unknown[], parentIdx: number): MCPToolRef[] {
  return raw.map((item, j) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") {
      throw new Error(`tools[${parentIdx}].tools[${j}] must be a string or { tool: string }`);
    }
    const obj = item as Record<string, unknown>;
    return {
      tool: requireString(obj, "tool"),
      name: obj.name as string | undefined,
      description: obj.description as string | undefined,
      params: obj.params as Record<string, string> | undefined,
    };
  });
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing required string field '${key}'`);
  }
  return v;
}
