import { parse as parseYAML } from "yaml";
import { parseAgentRef } from "@agntz/core";
import type {
  AgentManifest,
  AgentRef,
  LLMAgentManifest,
  ToolAgentManifest,
  SequentialAgentManifest,
  ParallelAgentManifest,
  StepRef,
  ManifestToolEntry,
  MCPToolRef,
  HTTPToolEntry,
  ResourceManifestEntry,
} from "./types.js";

/**
 * Parse a YAML string into an AgentManifest.
 */
export function parseManifest(yaml: string): AgentManifest {
  const raw = parseYAML(yaml);
  return normalizeManifest(raw);
}

/**
 * Normalize a raw parsed object into a typed AgentManifest.
 */
export function normalizeManifest(raw: Record<string, unknown>): AgentManifest {
  const kind = raw.kind as string;
  if (!kind) throw new Error("Agent manifest must have a 'kind' field");

  const base = {
    id: requireString(raw, "id"),
    name: raw.name as string | undefined,
    description: raw.description as string | undefined,
    inputSchema: raw.inputSchema as Record<string, unknown> | undefined,
    stateKey: raw.stateKey as string | undefined,
  };

  switch (kind) {
    case "llm":
      return normalizeLLM(base, raw);
    case "tool":
      return normalizeTool(base, raw);
    case "sequential":
      return normalizeSequential(base, raw);
    case "parallel":
      return normalizeParallel(base, raw);
    default:
      throw new Error(`Unknown agent kind: ${kind}`);
  }
}

function normalizeLLM(base: Record<string, unknown>, raw: Record<string, unknown>): LLMAgentManifest {
  return {
    ...base,
    kind: "llm",
    model: normalizeModel(raw.model),
    instruction: requireString(raw, "instruction"),
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    examples: raw.examples as LLMAgentManifest["examples"],
    tools: raw.tools ? normalizeTools(raw.tools as unknown[]) : undefined,
    outputSchema: raw.outputSchema as Record<string, unknown> | undefined,
    spawnable: raw.spawnable ? normalizeSpawnable(raw.spawnable as unknown[]) : undefined,
    skills: raw.skills ? normalizeSkills(raw.skills as unknown[]) : undefined,
    reply: raw.reply !== undefined ? normalizeReply(raw.reply) : undefined,
    resources: raw.resources !== undefined ? normalizeResources(raw.resources) : undefined,
  } as LLMAgentManifest;
}

function normalizeResources(raw: unknown): Record<string, ResourceManifestEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("'resources' must be an object keyed by resource name");
  }

  const resources: Record<string, ResourceManifestEntry> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`resources.${name} must be an object`);
    }
    const entry = value as Record<string, unknown>;
    if (entry.kind !== undefined && typeof entry.kind !== "string") {
      throw new Error(`resources.${name}.kind must be a string`);
    }
    resources[name] = {
      ...entry,
      kind: (entry.kind as string | undefined) ?? name,
      mode: entry.mode as ResourceManifestEntry["mode"],
      namespace: entry.namespace as ResourceManifestEntry["namespace"],
    };
  }
  return resources;
}

// Accept `reply: true` for defaults or `reply: { maxPerRun: N }` for a custom
// rate limit. `reply: false` round-trips as undefined (i.e. no tool).
function normalizeReply(raw: unknown): boolean | { maxPerRun?: number } | undefined {
  if (raw === true) return true;
  if (raw === false) return undefined;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const out: { maxPerRun?: number } = {};
    if (obj.maxPerRun !== undefined) {
      if (typeof obj.maxPerRun !== "number" || !Number.isFinite(obj.maxPerRun) || obj.maxPerRun < 1) {
        throw new Error("'reply.maxPerRun' must be a positive number");
      }
      out.maxPerRun = obj.maxPerRun;
    }
    return out;
  }
  throw new Error("'reply' must be a boolean or { maxPerRun: number }");
}

function normalizeSpawnable(raw: unknown[]): AgentRef[] {
  return raw.map((entry, i) => {
    const e = entry as Record<string, unknown>;
    const kind = e.kind as string;

    if (kind === "ref") {
      const out: AgentRef = {
        kind: "ref" as const,
        agentId: requireString(e, "agentId"),
      };
      if (e.version !== undefined) {
        if (typeof e.version !== "string") {
          throw new Error(`spawnable[${i}].version must be a string`);
        }
        try {
          // Reuse the core parser's validation rules. The agentId itself is
          // already structured, so we only need to validate the version shape.
          parseAgentRef(`${out.agentId}@${e.version}`);
        } catch (err) {
          throw new Error(
            `spawnable[${i}].version is invalid: ${(err as Error).message}`,
          );
        }
        out.version = e.version;
      }
      return out;
    }
    if (kind === "inline") {
      const def = e.definition;
      if (!def || typeof def !== "object") {
        throw new Error(`spawnable[${i}].definition is required for inline refs`);
      }
      const inlineManifest = normalizeManifest(def as Record<string, unknown>);
      if (inlineManifest.kind !== "llm") {
        throw new Error(`spawnable[${i}].definition must be an llm-kind manifest (got ${inlineManifest.kind})`);
      }
      return { kind: "inline" as const, definition: inlineManifest };
    }
    throw new Error(`spawnable[${i}].kind must be 'ref' or 'inline' (got '${kind}')`);
  });
}

const SKILL_NAME_RE = /^[a-z][a-z0-9-]*$/;

// Normalize the `skills:` array on an LLM manifest into a string[] of names.
function normalizeSkills(raw: unknown[]): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("'skills' must be an array of strings");
  }
  return raw.map((entry, i) => {
    if (typeof entry !== "string") {
      throw new Error(`skills[${i}] must be a string (got ${typeof entry})`);
    }
    if (!SKILL_NAME_RE.test(entry)) {
      throw new Error(`skills[${i}] '${entry}' must match ${SKILL_NAME_RE.source}`);
    }
    return entry;
  });
}

function normalizeTool(base: Record<string, unknown>, raw: Record<string, unknown>): ToolAgentManifest {
  const tool = raw.tool as Record<string, unknown>;
  if (!tool) throw new Error("Tool agent must have a 'tool' field");

  return {
    ...base,
    kind: "tool",
    tool: {
      kind: tool.kind as "mcp" | "local" | "http",
      name: requireString(tool, "name"),
      params: tool.params as Record<string, string> | undefined,
      server: tool.server as string | undefined,
      url: tool.url as string | undefined,
      method: tool.method as "GET" | undefined,
      description: tool.description as string | undefined,
      headers: tool.headers as Record<string, string> | undefined,
    },
  } as ToolAgentManifest;
}

function normalizeSequential(base: Record<string, unknown>, raw: Record<string, unknown>): SequentialAgentManifest {
  const steps = raw.steps as unknown[];
  if (!steps || !Array.isArray(steps)) throw new Error("Sequential agent must have a 'steps' array");

  return {
    ...base,
    kind: "sequential",
    steps: steps.map(normalizeStep),
    until: raw.until as string | undefined,
    maxIterations: raw.maxIterations as number | undefined,
    output: raw.output as Record<string, unknown> | undefined,
  } as SequentialAgentManifest;
}

function normalizeParallel(base: Record<string, unknown>, raw: Record<string, unknown>): ParallelAgentManifest {
  const branches = raw.branches as unknown[];
  if (!branches || !Array.isArray(branches)) throw new Error("Parallel agent must have a 'branches' array");

  return {
    ...base,
    kind: "parallel",
    branches: branches.map(normalizeStep),
    output: raw.output as Record<string, unknown> | undefined,
  } as ParallelAgentManifest;
}

function normalizeStep(raw: unknown): StepRef {
  const step = raw as Record<string, unknown>;

  const result: StepRef = {
    input: step.input as Record<string, string> | undefined,
    stateKey: step.stateKey as string | undefined,
    when: step.when as string | undefined,
  };

  if (typeof step.ref === "string") {
    result.ref = step.ref;
  } else if (step.agent != null) {
    result.agent = normalizeManifest(step.agent as Record<string, unknown>);
  } else {
    throw new Error("Step must have either 'ref' (agent ID) or 'agent' (inline definition)");
  }

  return result;
}

function normalizeModel(raw: unknown): LLMAgentManifest["model"] {
  if (!raw || typeof raw !== "object") throw new Error("LLM agent must have a 'model' field");
  const model = raw as Record<string, unknown>;
  return {
    provider: requireString(model, "provider"),
    name: requireString(model, "name"),
    temperature: model.temperature as number | undefined,
    maxTokens: model.maxTokens as number | undefined,
    topP: model.topP as number | undefined,
  };
}

function normalizeTools(raw: unknown[]): ManifestToolEntry[] {
  return raw.map((entry) => {
    const e = entry as Record<string, unknown>;
    const kind = e.kind as string;

    switch (kind) {
      case "mcp":
        return {
          kind: "mcp" as const,
          server: requireString(e, "server"),
          tools: e.tools ? normalizeMCPToolRefs(e.tools as unknown[]) : undefined,
          headers: e.headers as Record<string, string> | undefined,
        };
      case "local":
        return {
          kind: "local" as const,
          tools: e.tools as string[],
        };
      case "agent": {
        const agentField = requireString(e, "agent");
        const out: ManifestToolEntry = {
          kind: "agent" as const,
          agent: agentField,
        };
        if (e.version !== undefined) {
          if (typeof e.version !== "string") {
            throw new Error("tools[*].version must be a string");
          }
          if (agentField.includes("@")) {
            throw new Error(
              "tools[*] for kind 'agent' must not combine an '@version' suffix in 'agent' with a separate 'version' field",
            );
          }
          try {
            parseAgentRef(`${agentField}@${e.version}`);
          } catch (err) {
            throw new Error(
              `tools[*].version is invalid: ${(err as Error).message}`,
            );
          }
          out.version = e.version;
        } else if (agentField.includes("@")) {
          // Validate the suffix shape eagerly so callers see errors at parse
          // time. The runner will re-parse later — this is purely a friendly
          // failure-mode change.
          try {
            parseAgentRef(agentField);
          } catch (err) {
            throw new Error(
              `tools[*].agent is invalid: ${(err as Error).message}`,
            );
          }
        }
        return out;
      }
      case "http":
        return {
          kind: "http" as const,
          name: requireString(e, "name"),
          url: requireString(e, "url"),
          method: e.method as HTTPToolEntry["method"],
          description: e.description as string | undefined,
          params: e.params as Record<string, string> | undefined,
          headers: e.headers as Record<string, string> | undefined,
          body_type: e.body_type as HTTPToolEntry["body_type"],
          body: e.body,
          auth: e.auth as HTTPToolEntry["auth"],
        };
      default:
        throw new Error(`Unknown tool kind: ${kind}`);
    }
  });
}

function normalizeMCPToolRefs(raw: unknown[]): MCPToolRef[] {
  return raw.map((item) => {
    if (typeof item === "string") return item;
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
  const value = obj[key];
  if (typeof value !== "string") throw new Error(`Missing required string field '${key}'`);
  return value;
}
