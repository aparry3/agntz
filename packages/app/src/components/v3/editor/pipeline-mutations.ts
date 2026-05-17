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

export type RootManifest = Record<string, unknown>;

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
