import type { TestDefinition } from "../types.js";
import { assertNonEmptyText, modelConfig, provider } from "./_helpers.js";

export const multiTurnText: TestDefinition = {
	id: "multi-turn-text",
	capability: "multiTurn",
	async run(model, ctx) {
		const result = await provider.generateText({
			model: modelConfig(model),
			messages: [
				{ role: "user", content: "What is 2 plus 2?" },
				{ role: "assistant", content: "4" },
				{
					role: "user",
					content: "And now subtract 1 from that. Reply with just the number.",
				},
			],
			maxTokens: 256,
			signal: ctx.abortSignal,
		});
		return assertNonEmptyText(result.text);
	},
};
