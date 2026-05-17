// Helpers for mutating the root manifest of a pipeline. Built on top of the
// `getIn` / `setIn` JSON-pointer utilities from pipeline-types.ts so the
// inspector can apply targeted edits (input map updates, step add / remove
// / reorder) without having to know the underlying tree shape.

import {
  getIn,
  isRecord,
  setIn,
  type PipelinePath,
} from "@/components/agent-builder/pipeline-types";
import type { SingleAgentManifest } from "./single-agent-view";

export type RootManifest = Record<string, unknown>;

/* ── Convert a single-LLM manifest into a 1-step sequential pipeline ───── */

/**
 * Wrap a kind=llm manifest in a sequential pipeline with exactly one step.
 *
 * The pipeline keeps the original id, name, description, and inputSchema so
 * the agent's external contract is unchanged. The inner step inherits every
 * LLM-specific field (model, instruction, prompt, examples, tools, etc.)
 * and gets a fresh id (`step_1` by default). Each declared input is mapped
 * verbatim to the new step's input map so templates keep resolving.
 */
export function convertSingleAgentToPipeline(
  manifest: SingleAgentManifest,
  stepId = "step_1"
): RootManifest {
  const stepAgent: Record<string, unknown> = { id: stepId, kind: "llm" };
  if (manifest.model) stepAgent.model = manifest.model;
  if (manifest.instruction) stepAgent.instruction = manifest.instruction;
  if (manifest.prompt) stepAgent.prompt = manifest.prompt;
  if (manifest.examples?.length) stepAgent.examples = manifest.examples;
  if (manifest.tools?.length) stepAgent.tools = manifest.tools;
  if (manifest.outputSchema) stepAgent.outputSchema = manifest.outputSchema;
  if (manifest.skills?.length) stepAgent.skills = manifest.skills;
  if (manifest.reply !== undefined) stepAgent.reply = manifest.reply;
  if (manifest.inputSchema) stepAgent.inputSchema = manifest.inputSchema;

  const step: Record<string, unknown> = { agent: stepAgent };
  const inputKeys = Object.keys(manifest.inputSchema ?? {});
  if (inputKeys.length > 0) {
    const inputMap: Record<string, string> = {};
    for (const key of inputKeys) inputMap[key] = `{{${key}}}`;
    step.input = inputMap;
  }

  const pipeline: RootManifest = { kind: "sequential" };
  if (manifest.id) pipeline.id = manifest.id;
  if (manifest.name) pipeline.name = manifest.name;
  if (manifest.description) pipeline.description = manifest.description;
  if (manifest.inputSchema) pipeline.inputSchema = manifest.inputSchema;
  pipeline.steps = [step];

  return pipeline;
}

/** Container key for root steps — `steps` for sequential, `branches` for parallel. */
export function containerKeyForKind(kind: unknown): "steps" | "branches" {
  return kind === "parallel" ? "branches" : "steps";
}

/* ── Step add / remove / move at the root level ────────────────────────── */

export function appendStepAtRoot(
  root: RootManifest,
  step: Record<string, unknown>
): RootManifest {
  const containerKey = containerKeyForKind(root.kind);
  const current = Array.isArray(root[containerKey]) ? (root[containerKey] as unknown[]) : [];
  return setIn(root, [containerKey, current.length], step) as RootManifest;
}

export function removeStepAt(root: RootManifest, stepPath: PipelinePath): RootManifest {
  return setIn(root, stepPath, undefined) as RootManifest;
}

/**
 * Move a step at `stepPath` by `delta` positions within its containing array.
 * No-op if the move would go out of bounds.
 */
export function moveStepAt(
  root: RootManifest,
  stepPath: PipelinePath,
  delta: -1 | 1
): RootManifest {
  if (stepPath.length === 0) return root;
  const lastSeg = stepPath[stepPath.length - 1];
  const containerPath = stepPath.slice(0, -1);
  const container = getIn(root, containerPath);
  if (!Array.isArray(container)) return root;
  if (typeof lastSeg !== "number") return root;
  const newIndex = lastSeg + delta;
  if (newIndex < 0 || newIndex >= container.length) return root;

  const next = [...container];
  const [moved] = next.splice(lastSeg, 1);
  next.splice(newIndex, 0, moved);
  return setIn(root, containerPath, next) as RootManifest;
}

/* ── Agent record edits at a specific JSON-pointer path ───────────────── */

/**
 * Shallow-merge `partial` into the agent record at `agentPath`. Keys whose
 * value is `undefined` are deleted (matches the convention used by the
 * single-agent editor's `patch({ field: undefined })`).
 *
 * Used by the pipeline inspector to mutate individual step agents
 * (description, model, instruction, tools, etc.) without disturbing the
 * surrounding pipeline structure.
 */
export function patchAgentAt(
  root: RootManifest,
  agentPath: PipelinePath,
  partial: Record<string, unknown>,
): RootManifest {
  const existing = getIn(root, agentPath);
  const base = isRecord(existing) ? existing : {};
  const next: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return setIn(root, agentPath, next) as RootManifest;
}

/* ── Input-map edits on a specific step ────────────────────────────────── */

export function patchStepInputMap(
  root: RootManifest,
  stepPath: PipelinePath,
  key: string,
  value: string | undefined
): RootManifest {
  const stepRef = getIn(root, stepPath);
  if (!isRecord(stepRef)) return root;
  const existing = isRecord(stepRef.input) ? stepRef.input : {};
  const nextInput: Record<string, unknown> = { ...existing };
  if (value === undefined) {
    delete nextInput[key];
  } else {
    nextInput[key] = value;
  }
  const nextStep: Record<string, unknown> = { ...stepRef };
  if (Object.keys(nextInput).length === 0) {
    delete nextStep.input;
  } else {
    nextStep.input = nextInput;
  }
  return setIn(root, stepPath, nextStep) as RootManifest;
}
