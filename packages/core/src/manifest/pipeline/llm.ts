import { renderTemplate } from "../template.js";
import type {
	AgentState,
	ExecutionContext,
	ExecutionResult,
	LLMAgentManifest,
} from "../types.js";

/**
 * Execute an LLM agent: render the instruction (system prompt) and optional
 * user prompt template, then call the LLM via the core runner.
 */
export async function executeLLM(
	manifest: LLMAgentManifest,
	state: AgentState,
	ctx: ExecutionContext,
): Promise<ExecutionResult> {
	const instruction = renderTemplate(manifest.instruction, state);
	const prompt = manifest.prompt
		? renderTemplate(manifest.prompt, state)
		: undefined;

	const output = await ctx.invokeLLM(manifest, instruction, prompt, state);

	return {
		output,
		state: { ...state },
	};
}
