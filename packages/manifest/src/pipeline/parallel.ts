import type { ParallelAgentManifest, AgentManifest, AgentState, ExecutionContext, ExecutionResult, StepRef } from "../types.js";
import { getStateKey, applyInputTransform, createInitialState, applyOutputMapping } from "../state.js";
import { executeWithState } from "../executor.js";

/**
 * Execute a parallel agent: run all branches concurrently, merge outputs into state.
 */
export async function executeParallel(
  manifest: ParallelAgentManifest,
  state: AgentState,
  ctx: ExecutionContext,
  parentInput: unknown
): Promise<ExecutionResult> {
  // Launch all branches concurrently. Each branch's default upstream is the
  // parent's input — branches run independently and never see sibling state.
  const branchPromises = manifest.branches.map(async (step) => {
    const childManifest = await resolveStepAgent(step, ctx);
    const childInput = applyInputTransform(step.input, state, parentInput);
    const childState = createInitialState(childInput, childManifest.inputSchema);
    const result = await executeWithState(childManifest, childState, ctx, childInput);
    const key = getStateKey(step);
    return { key, output: result.output };
  });

  const results = await Promise.all(branchPromises);

  // Merge all branch outputs into state
  for (const { key, output } of results) {
    state[key] = output;
  }

  // Apply output mapping if specified, otherwise return all branch outputs as object
  let output: unknown;
  if (manifest.output) {
    output = applyOutputMapping(manifest.output, state);
  } else {
    const merged: Record<string, unknown> = {};
    for (const { key, output: branchOutput } of results) {
      merged[key] = branchOutput;
    }
    output = merged;
  }

  return { output, state };
}

async function resolveStepAgent(step: StepRef, ctx: ExecutionContext): Promise<AgentManifest> {
  if (step.ref) return ctx.resolveAgent(step.ref);
  if (step.agent) return step.agent;
  throw new Error("Step must have either 'ref' or 'agent'");
}
