import type {
  AgentManifest,
  AgentState,
  ExecutionContext,
  ExecutionResult,
  LLMAgentManifest,
  ToolAgentManifest,
  SequentialAgentManifest,
  ParallelAgentManifest,
} from "./types.js";
import { createInitialState } from "./state.js";
import { executeLLM } from "./pipeline/llm.js";
import { executeTool } from "./pipeline/tool.js";
import { executeSequential } from "./pipeline/sequential.js";
import { executeParallel } from "./pipeline/parallel.js";

/**
 * Execute an agent manifest with the given input.
 *
 * This is the top-level entry point. It creates the initial state from
 * input + inputSchema, then dispatches to the appropriate executor.
 */
export async function execute(
  manifest: AgentManifest,
  input: unknown,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  const state = createInitialState(input, manifest.inputSchema);
  return executeWithState(manifest, state, ctx);
}

/**
 * Execute an agent manifest with pre-built state.
 * Used internally for pipeline steps where state is already constructed.
 */
export async function executeWithState(
  manifest: AgentManifest,
  state: AgentState,
  ctx: ExecutionContext
): Promise<ExecutionResult> {
  switch (manifest.kind) {
    case "llm":
      return executeLLM(manifest as LLMAgentManifest, state, ctx);
    case "tool":
      return executeTool(manifest as ToolAgentManifest, state, ctx);
    case "sequential":
      return executeSequential(manifest as SequentialAgentManifest, state, ctx);
    case "parallel":
      return executeParallel(manifest as ParallelAgentManifest, state, ctx);
    default:
      throw new Error(`Unknown agent kind: ${(manifest as AgentManifest).kind}`);
  }
}
