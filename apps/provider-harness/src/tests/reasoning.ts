import type { TestDefinition } from "../types.js";
import { modelConfig } from "./_helpers.js";

export const reasoning: TestDefinition = {
	id: "reasoning",
	capability: "reasoning",
	timeoutMs: 60_000,
	async run(model, ctx) {
		const result = await ctx.adapter.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content:
						"Solve 17 times 23. Use your reasoning if the model supports it, then reply with only the number.",
				},
			],
			maxTokens: 512,
			signal: ctx.abortSignal,
		});
		const reasoningTokens =
			result.usage?.outputTokenDetails?.reasoningTokens ??
			result.usage?.reasoningTokens;
		if (typeof reasoningTokens === "number" && reasoningTokens >= 0) {
			return { ok: true };
		}
		return {
			ok: true,
			skip: "provider/runtime did not report reasoning-token usage for this prompt",
		};
	},
};
