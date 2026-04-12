import type { ToolAgentManifest, AgentState, ExecutionContext, ExecutionResult } from "../types.js";
import { interpolate } from "../template.js";

/**
 * Execute a tool agent: resolve params from state, call the tool directly.
 */
export async function executeTool(
  manifest: ToolAgentManifest,
  state: AgentState,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  // Resolve params from state
  const resolvedConfig = { ...manifest.tool };
  if (resolvedConfig.params) {
    const resolvedParams: Record<string, string> = {};
    for (const [key, template] of Object.entries(resolvedConfig.params)) {
      resolvedParams[key] = interpolate(template, state);
    }
    resolvedConfig.params = resolvedParams;
  }

  const output = await ctx.invokeTool(resolvedConfig, state);

  return {
    output,
    state: { ...state },
  };
}
