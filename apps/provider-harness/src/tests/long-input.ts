import type { TestDefinition } from "../types.js";
import { assertNonEmptyText, modelConfig } from "./_helpers.js";

// ~500 repeats × 47 chars ≈ 23.5k chars ≈ ~5.8k tokens — non-trivial but cheap.
// Catches truncation, encoding, and message-size bugs in the SDK.
const FILLER = "The quick brown fox jumps over the lazy dog. ".repeat(500);

export const longInput: TestDefinition = {
	id: "long-input",
	capability: "text",
	timeoutMs: 60_000,
	async run(model, ctx) {
		const result = await ctx.adapter.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content: `${FILLER}\n\nReply with the single word OK.`,
				},
			],
			maxTokens: 256,
			signal: ctx.abortSignal,
		});
		return assertNonEmptyText(result.text);
	},
};
