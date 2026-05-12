import type { SkillDefinition, ToolReference } from "./types.js";

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Define a skill. Validates the definition; SkillStore.putSkill calls this
 * so structurally-invalid skills never persist.
 */
export function defineSkill(definition: SkillDefinition): SkillDefinition {
  if (typeof definition.name !== "string" || !NAME_RE.test(definition.name)) {
    throw new Error(
      `Skill name must match ${NAME_RE} (lowercase-kebab-case)`,
    );
  }
  if (typeof definition.description !== "string" || definition.description.trim() === "") {
    throw new Error("Skill definition requires a non-empty 'description'");
  }
  if (typeof definition.instructions !== "string" || definition.instructions.trim() === "") {
    throw new Error("Skill definition requires a non-empty 'instructions'");
  }
  if (definition.tools !== undefined) {
    if (!Array.isArray(definition.tools)) {
      throw new Error("Skill 'tools' must be an array of ToolReference");
    }
    for (let i = 0; i < definition.tools.length; i++) {
      validateToolReference(definition.tools[i], i);
    }
  }
  return definition;
}

function validateToolReference(ref: ToolReference, index: number): void {
  if (!ref || typeof ref !== "object") {
    throw new Error(`Skill tools[${index}] is not a valid ToolReference`);
  }
  const r = ref as { type?: string; name?: unknown; server?: unknown; tools?: unknown; agentId?: unknown };
  if (r.type === "inline") {
    if (typeof r.name !== "string" || r.name === "") {
      throw new Error(`Skill tools[${index}] (inline) requires a non-empty 'name'`);
    }
  } else if (r.type === "mcp") {
    if (typeof r.server !== "string" || r.server === "") {
      throw new Error(`Skill tools[${index}] (mcp) requires a non-empty 'server'`);
    }
    if (r.tools !== undefined && !Array.isArray(r.tools)) {
      throw new Error(`Skill tools[${index}] (mcp) 'tools' must be a string array when present`);
    }
  } else if (r.type === "agent") {
    if (typeof r.agentId !== "string" || r.agentId === "") {
      throw new Error(`Skill tools[${index}] (agent) requires a non-empty 'agentId'`);
    }
  } else {
    throw new Error(`Skill tools[${index}] has unknown type "${String(r.type)}"`);
  }
}
