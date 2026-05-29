import type { TestDefinition } from "../types.js";
import { assertNonEmptyText, modelConfig, provider } from "./_helpers.js";

export const systemPrompt: TestDefinition = {
	id: "system-prompt",
	capability: "systemPrompt",
	async run(model, ctx) {
		const result = await provider.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "system",
					content: "You are a terse assistant. Reply with a single short word.",
				},
				{ role: "user", content: "Hello" },
			],
			maxTokens: 256,
			signal: ctx.abortSignal,
		});
		// Structural check only — we don't assert on the model's interpretation
		// of the system prompt, just that the call shape with a system role works.
		return assertNonEmptyText(result.text);
	},
};
