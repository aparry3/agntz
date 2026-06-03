import type { TestDefinition } from "../types.js";
import { WEATHER_TOOL, assertNonEmptyText, modelConfig } from "./_helpers.js";

export const toolChoiceAuto: TestDefinition = {
	id: "tool-choice-auto",
	capability: "toolChoice",
	timeoutMs: 60_000,
	async run(model, ctx) {
		// core's generateText doesn't expose an explicit tool_choice directive, so
		// we exercise the default (auto): tools are available but the prompt does
		// not need them. A correct SDK returns plain text with no spurious call.
		// Catches adapters that force a tool call whenever tools are present.
		const result = await ctx.adapter.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content: "Reply with the single word OK. Do not call any tools.",
				},
			],
			tools: [WEATHER_TOOL],
			maxTokens: 512,
			signal: ctx.abortSignal,
		});

		const calls = result.toolCalls ?? [];
		if (calls.length > 0) {
			return {
				ok: false,
				reason: `expected no tool call for a no-tool prompt, got ${calls.length} (${calls
					.map((c) => c.name)
					.join(", ")})`,
			};
		}
		return assertNonEmptyText(result.text);
	},
};
