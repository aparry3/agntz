import type { LLMAgentManifest, AgentState, ExecutionContext, ExecutionResult } from "../types.js";
import { renderTemplate } from "../template.js";

/**
 * Execute an LLM agent: render the instruction template, call the LLM via core runner.
 */
export async function executeLLM(
  manifest: LLMAgentManifest,
  state: AgentState,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  // Render instruction with state
  const instruction = renderTemplate(manifest.instruction, state);

  // Build a user prompt from the state (the "input" to the LLM)
  // For LLM agents, we pass the rendered instruction + state to the core runner
  const output = await ctx.invokeLLM(manifest, instruction, state);

  return {
    output,
    state: { ...state },
  };
}
