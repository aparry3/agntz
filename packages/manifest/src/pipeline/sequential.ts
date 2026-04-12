import type { SequentialAgentManifest, AgentManifest, AgentState, ExecutionContext, ExecutionResult, StepRef } from "../types.js";
import { getStateKey, getAgentId, applyInputTransform, createInitialState, applyOutputMapping } from "../state.js";
import { evaluateCondition } from "../conditions.js";
import { executeWithState } from "../executor.js";

/**
 * Execute a sequential agent: run steps in order, accumulating state.
 * Optionally loops with `until` condition and `maxIterations` safety limit.
 */
export async function executeSequential(
  manifest: SequentialAgentManifest,
  state: AgentState,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  const isLoop = !!manifest.until;
  const maxIterations = manifest.maxIterations ?? 100;
  let iteration = 0;

  do {
    // Run all steps in order
    for (const step of manifest.steps) {
      // Check when condition
      if (step.when && !evaluateCondition(step.when, state)) {
        // Skipped — set output to null on state
        const key = getStateKey(step);
        state[key] = null;
        continue;
      }

      // Resolve the agent manifest
      const childManifest = await resolveStepAgent(step, ctx);

      // Apply input transform: map parent state → child input
      const childInput = applyInputTransform(step.input, state);

      // Create child state from the transformed input
      const childState = createInitialState(childInput, childManifest.inputSchema);

      // Execute
      const result = await executeWithState(childManifest, childState, ctx);

      // Write output to parent state under the step's state key
      const key = getStateKey(step);
      state[key] = result.output;
    }

    iteration++;

    // Check loop exit condition
    if (isLoop && evaluateCondition(manifest.until!, state)) {
      break;
    }
  } while (isLoop && iteration < maxIterations);

  // Apply output mapping if specified, otherwise use last step's output
  let output: unknown;
  if (manifest.output) {
    output = applyOutputMapping(manifest.output, state);
  } else if (manifest.steps.length > 0) {
    const lastKey = getStateKey(manifest.steps[manifest.steps.length - 1]);
    output = state[lastKey];
  } else {
    output = null;
  }

  return { output, state };
}

async function resolveStepAgent(step: StepRef, ctx: ExecutionContext): Promise<AgentManifest> {
  if (typeof step.agent === "string") {
    return ctx.resolveAgent(step.agent);
  }
  return step.agent;
}
