import { executeLLM } from "./pipeline/llm.js";
import { executeParallel } from "./pipeline/parallel.js";
import { executeSequential } from "./pipeline/sequential.js";
import { executeTool } from "./pipeline/tool.js";
import { createInitialState } from "./state.js";
import type {
	AgentManifest,
	AgentState,
	ExecutionContext,
	ExecutionResult,
	LLMAgentManifest,
	ParallelAgentManifest,
	SequentialAgentManifest,
	ToolAgentManifest,
} from "./types.js";

/**
 * Execute an agent manifest with the given input.
 *
 * This is the top-level entry point. It creates the initial state from
 * input + inputSchema, then dispatches to the appropriate executor.
 */
export async function execute(
	manifest: AgentManifest,
	input: unknown,
	ctx: ExecutionContext,
): Promise<ExecutionResult> {
	const state = createInitialState(input, manifest.inputSchema);
	return executeWithState(manifest, state, ctx, input);
}

/**
 * Execute an agent manifest with pre-built state.
 * Used internally for pipeline steps where state is already constructed.
 * `parentInput` is the raw input that produced `state` — pipeline executors
 * use it as the default upstream for their first step.
 */
export async function executeWithState(
	manifest: AgentManifest,
	state: AgentState,
	ctx: ExecutionContext,
	parentInput: unknown,
): Promise<ExecutionResult> {
	const span = ctx.spanEmitter?.startManifest({
		ownerId: ctx.ownerId ?? "",
		agentId: manifest.id,
		kind: manifest.kind,
	});
	try {
		let result: ExecutionResult;
		switch (manifest.kind) {
			case "llm":
				result = await executeLLM(manifest as LLMAgentManifest, state, ctx);
				break;
			case "tool":
				result = await executeTool(manifest as ToolAgentManifest, state, ctx);
				break;
			case "sequential":
				result = await executeSequential(
					manifest as SequentialAgentManifest,
					state,
					ctx,
					parentInput,
				);
				break;
			case "parallel":
				result = await executeParallel(
					manifest as ParallelAgentManifest,
					state,
					ctx,
					parentInput,
				);
				break;
			default:
				throw new Error(
					`Unknown agent kind: ${(manifest as AgentManifest).kind}`,
				);
		}
		span?.end();
		return result;
	} catch (err) {
		span?.error(err as Error);
		throw err;
	}
}
