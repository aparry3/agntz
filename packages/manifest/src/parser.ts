import { parse as parseYAML } from "yaml";
import type {
  AgentManifest,
  LLMAgentManifest,
  ToolAgentManifest,
  SequentialAgentManifest,
  ParallelAgentManifest,
  StepRef,
  ManifestToolEntry,
  MCPToolRef,
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
    examples: raw.examples as LLMAgentManifest["examples"],
    tools: raw.tools ? normalizeTools(raw.tools as unknown[]) : undefined,
    outputSchema: raw.outputSchema as Record<string, unknown> | undefined,
  } as LLMAgentManifest;
}

function normalizeTool(base: Record<string, unknown>, raw: Record<string, unknown>): ToolAgentManifest {
  const tool = raw.tool as Record<string, unknown>;
  if (!tool) throw new Error("Tool agent must have a 'tool' field");

  return {
    ...base,
    kind: "tool",
    tool: {
      kind: tool.kind as "mcp" | "local",
      server: tool.server as string | undefined,
      name: requireString(tool, "name"),
      params: tool.params as Record<string, string> | undefined,
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
        };
      case "local":
        return {
          kind: "local" as const,
          tools: e.tools as string[],
        };
      case "agent":
        return {
          kind: "agent" as const,
          agent: requireString(e, "agent"),
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
