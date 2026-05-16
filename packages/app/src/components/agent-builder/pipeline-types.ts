// Normalized tree for the vertical pipeline view. The raw YAML manifest is a
// nested mix of `steps[].agent`, `branches[].agent`, and inline kind switches;
// the tree below flattens that into a recursive `PipelineNode` so the
// renderer doesn't have to peek into both `StepRef` and `AgentManifest` at
// every level.
//
// Every node carries the JSON path back into the parsed manifest so the
// inspector can write field edits straight to the source without re-parsing.
// `agentPath` points at the AgentManifest fields (model, instruction, steps,
// branches…); `stepPath` points at the StepRef wrapping it (carrying
// `input`, `stateKey`, `when`). The root has no `stepPath`.

import type { PipelineKind } from "./pipeline-tokens";

export type PipelinePath = (string | number)[];

export interface PipelineNode {
  /** Pipeline-display kind. `loop` is rendered like sequential with a footer. */
  kind: PipelineKind;
  /** True when this node is a sequential container with `until`. */
  isLoop: boolean;
  /** Agent id from the manifest, or a fallback derived from path. */
  id: string;
  /** Display name; falls back to id. */
  name: string;
  description?: string;
  /** Path to the agent manifest object inside the parsed root manifest. */
  agentPath: PipelinePath;
  /**
   * Path to the StepRef wrapper inside the parsed root manifest (undefined
   * for the root). The StepRef holds `input`, `stateKey`, `when`.
   */
  stepPath?: PipelinePath;
  /** True when this is the root agent. */
  isRoot: boolean;

  // Container fields
  steps?: PipelineNode[];
  branches?: PipelineNode[];
  loop?: { until: string; maxIterations?: number };

  // LLM body
  model?: { provider: string; name: string };
  instructionPreview?: string;
  outputSchemaKeys?: Array<{ key: string; type: string }>;

  // Tool body
  toolKind?: "local" | "mcp";
  toolServer?: string;
  toolName?: string;
  toolParams?: Record<string, string>;

  // Input schema declared on this agent (used by inspector for child mapping).
  inputSchema?: Array<{ key: string; type: string; nullable: boolean; default?: unknown }>;

  // From the wrapping StepRef
  inputMap?: Record<string, string>;
  stateKey?: string;
}

// ─── Generic JSON-pointer helpers ────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getIn(root: unknown, path: PipelinePath): unknown {
  let cursor: unknown = root;
  for (const segment of path) {
    if (cursor == null) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment];
    } else {
      if (!isRecord(cursor)) return undefined;
      cursor = cursor[segment];
    }
  }
  return cursor;
}

/**
 * Returns a structurally-cloned copy of `root` with `path` set to `value`.
 * When `value` is `undefined`, the leaf key is deleted. Intermediate
 * containers are auto-created (object for string segments, array for number
 * segments) so callers can write into "deep but missing" paths.
 */
export function setIn(root: unknown, path: PipelinePath, value: unknown): unknown {
  if (path.length === 0) return value;

  const cloneStep = (current: unknown, segment: string | number): unknown => {
    if (typeof segment === "number") {
      if (Array.isArray(current)) return [...current];
      return [];
    }
    if (isRecord(current)) return { ...current };
    return {};
  };

  const out = cloneStep(root, path[0]);
  let cursor: Record<string | number, unknown> = out as Record<string | number, unknown>;

  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const nextSegment = path[i + 1];
    const child = cloneStep((cursor as Record<string | number, unknown>)[segment], nextSegment);
    (cursor as Record<string | number, unknown>)[segment] = child;
    cursor = child as Record<string | number, unknown>;
  }

  const lastSegment = path[path.length - 1];
  if (value === undefined) {
    if (Array.isArray(cursor) && typeof lastSegment === "number") {
      cursor.splice(lastSegment, 1);
    } else {
      delete (cursor as Record<string | number, unknown>)[lastSegment];
    }
  } else {
    (cursor as Record<string | number, unknown>)[lastSegment] = value;
  }

  return out;
}

// ─── Parser ──────────────────────────────────────────────────────────────

const VALID_KINDS: ReadonlyArray<PipelineKind> = ["llm", "tool", "sequential", "parallel"];

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readInputSchema(value: unknown): PipelineNode["inputSchema"] {
  if (!isRecord(value)) return undefined;
  const out: NonNullable<PipelineNode["inputSchema"]> = [];
  for (const [key, def] of Object.entries(value)) {
    if (typeof def === "string") {
      out.push({ key, type: def, nullable: false });
    } else if (isRecord(def)) {
      const type = typeof def.type === "string" ? def.type : "string";
      out.push({ key, type, nullable: false, default: def.default });
    }
  }
  return out.length > 0 ? out : undefined;
}

function readOutputSchema(value: unknown): PipelineNode["outputSchemaKeys"] {
  if (!isRecord(value)) return undefined;
  const out: NonNullable<PipelineNode["outputSchemaKeys"]> = [];
  for (const [key, def] of Object.entries(value)) {
    if (typeof def === "string") out.push({ key, type: def });
    else if (isRecord(def) && typeof def.type === "string") out.push({ key, type: def.type });
  }
  return out.length > 0 ? out : undefined;
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  let saw = false;
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") {
      out[k] = v;
      saw = true;
    }
  }
  return saw ? out : undefined;
}

function previewInstruction(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim().split("\n").slice(0, 3).join(" ").trim();
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 200)}…`;
}

/**
 * Walk a parsed AgentManifest (already a JS object) and produce a
 * PipelineNode tree. `agentPath` traces the path inside the parsed root,
 * and `stepPath` is set when this agent was wrapped in a StepRef
 * (i.e. all children of a sequential/parallel container).
 */
export function nodeFromAgent(
  agent: unknown,
  agentPath: PipelinePath,
  ctx: { isRoot: boolean; stepPath?: PipelinePath; stepInput?: Record<string, string>; stepStateKey?: string },
): PipelineNode {
  if (!isRecord(agent)) {
    return {
      kind: "llm",
      isLoop: false,
      id: "(invalid)",
      name: "(invalid agent)",
      agentPath,
      stepPath: ctx.stepPath,
      isRoot: ctx.isRoot,
    };
  }

  const kindRaw = asString(agent.kind);
  const kind: PipelineKind = (VALID_KINDS as readonly string[]).includes(kindRaw ?? "")
    ? (kindRaw as PipelineKind)
    : "llm";

  const id = asString(agent.id) ?? `step-${agentPath.length}`;
  const name = asString(agent.name) ?? id;
  const description = asString(agent.description);
  const stateKey = ctx.stepStateKey ?? asString(agent.stateKey);
  const inputSchema = readInputSchema(agent.inputSchema);

  // Loop = sequential with `until`/`maxIterations`. Until-only is enough
  // (maxIterations is metadata) — keep the `loop` block when either is set.
  const until = asString(agent.until);
  const maxIterations = typeof agent.maxIterations === "number" ? agent.maxIterations : undefined;
  const isLoop = kind === "sequential" && (until != null || maxIterations != null);

  const base: PipelineNode = {
    kind,
    isLoop,
    id,
    name,
    description,
    agentPath,
    stepPath: ctx.stepPath,
    isRoot: ctx.isRoot,
    inputMap: ctx.stepInput,
    stateKey,
    inputSchema,
  };

  if (kind === "llm") {
    const model = isRecord(agent.model) ? agent.model : null;
    if (model) {
      base.model = {
        provider: asString(model.provider) ?? "",
        name: asString(model.name) ?? "",
      };
    }
    base.instructionPreview = previewInstruction(asString(agent.instruction));
    base.outputSchemaKeys = readOutputSchema(agent.outputSchema);
    return base;
  }

  if (kind === "tool") {
    const tool = isRecord(agent.tool) ? agent.tool : null;
    if (tool) {
      const toolKind = asString(tool.kind);
      base.toolKind = toolKind === "mcp" ? "mcp" : "local";
      base.toolServer = asString(tool.server);
      base.toolName = asString(tool.name) ?? "(unnamed tool)";
      base.toolParams = readStringMap(tool.params);
    }
    return base;
  }

  // sequential / parallel: walk children
  if (kind === "sequential") {
    base.steps = readStepArray(agent.steps, [...agentPath, "steps"]);
    if (isLoop) {
      base.loop = {
        until: until ?? "",
        maxIterations,
      };
    }
    return base;
  }

  // parallel
  base.branches = readStepArray(agent.branches, [...agentPath, "branches"]);
  return base;
}

function readStepArray(value: unknown, basePath: PipelinePath): PipelineNode[] {
  if (!Array.isArray(value)) return [];
  return value.map((step, i) => {
    const stepPath: PipelinePath = [...basePath, i];
    if (!isRecord(step)) {
      return nodeFromAgent({}, [...stepPath, "agent"], {
        isRoot: false,
        stepPath,
      });
    }
    // StepRef shape: { agent: {...} } | { ref: "id" } (+ input/stateKey/when)
    const input = readStringMap(step.input);
    const stepStateKey = asString(step.stateKey);
    // ref-style steps render as a placeholder block; the inspector can
    // surface the ref in a future pass. Inline `agent` is the common case.
    if (isRecord(step.agent)) {
      return nodeFromAgent(step.agent, [...stepPath, "agent"], {
        isRoot: false,
        stepPath,
        stepInput: input,
        stepStateKey,
      });
    }
    const refId = asString(step.ref);
    return {
      kind: "llm",
      isLoop: false,
      id: refId ?? `ref-${i}`,
      name: refId ?? "(unresolved ref)",
      agentPath: [...stepPath, "agent"],
      stepPath,
      isRoot: false,
      inputMap: input,
      stateKey: stepStateKey,
    };
  });
}

/**
 * Find a node in the tree by id. Walks both `steps` and `branches`.
 * Returns the first match; ids are expected to be unique within a manifest
 * but we don't enforce that here.
 */
export function findNode(root: PipelineNode, id: string): PipelineNode | null {
  if (root.id === id) return root;
  const children = root.steps ?? root.branches ?? [];
  for (const child of children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Walks the tree to find the parent of the node with the given id. Returns
 * null for the root (it has no parent) and undefined if the id isn't found.
 * Used by the inspector's delete affordance so we can re-select a sensible
 * neighbour after pruning a step.
 */
export function findParent(root: PipelineNode, id: string): PipelineNode | null | undefined {
  if (root.id === id) return null;
  const children = root.steps ?? root.branches ?? [];
  for (const child of children) {
    if (child.id === id) return root;
    const found = findParent(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * State snapshot for the inspector's AVAILABLE STATE panel. Walks down from
 * the root to `target.id`, accumulating:
 *   - the root agent's declared `inputSchema` keys (visible everywhere)
 *   - for each container we pass through, the `stateKey` (or id) of every
 *     preceding sibling on that path — sub-agent outputs land under their
 *     stateKey on the parent's state.
 * Returns a flat list of references the user can drop into `{{...}}`.
 */
export interface StateRef {
  key: string;
  type: string;
  source: string;
  children?: Array<{ key: string; type: string }>;
}

export interface StateSnapshot {
  scope: string;
  keys: StateRef[];
}

export function computeAvailableStateAt(root: PipelineNode, targetId: string): StateSnapshot {
  const keys: StateRef[] = [];
  for (const f of root.inputSchema ?? []) {
    keys.push({ key: f.key, type: f.type, source: "input" });
  }

  function walk(container: PipelineNode): boolean {
    if (container.id === targetId) return true;
    const children = container.steps ?? container.branches ?? [];
    for (const child of children) {
      if (child.id === targetId) return true;
      // For parallel containers, all children see only the parent's input —
      // siblings run concurrently and don't write into one another's state.
      if (container.kind === "sequential") {
        if (walk(child)) return true;
        const stateKey = child.stateKey ?? child.id;
        const outputs = child.outputSchemaKeys ?? [];
        keys.push({
          key: stateKey,
          type: outputs.length > 0 ? "object" : "string",
          source: child.id,
          children: outputs.length > 0 ? outputs : undefined,
        });
      } else {
        if (walk(child)) return true;
      }
    }
    return false;
  }
  walk(root);
  return { scope: root.id, keys };
}
