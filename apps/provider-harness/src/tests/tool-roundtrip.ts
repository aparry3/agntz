import type { TestDefinition } from "../types.js";
import { WEATHER_TOOL, modelConfig } from "./_helpers.js";

export const toolRoundtrip: TestDefinition = {
	id: "tool-roundtrip",
	capability: "tools",
	timeoutMs: 60_000,
	async run(model, ctx) {
		const result = await ctx.adapter.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content:
						"What is the weather in Paris? You must call the get_weather tool to find out, then answer using the tool result.",
				},
			],
			tools: [WEATHER_TOOL],
			maxTokens: 1024,
			signal: ctx.abortSignal,
		});

		if (!result.toolCalls || result.toolCalls.length === 0) {
			return {
				ok: false,
				reason: `expected the runtime to execute at least one tool call, got none (finishReason: ${result.finishReason})`,
			};
		}
		const call = result.toolCalls[0];
		if (call.name !== WEATHER_TOOL.name) {
			return {
				ok: false,
				reason: `expected executed tool "${WEATHER_TOOL.name}", got "${call.name}"`,
			};
		}
		if (typeof result.text !== "string" || result.text.trim().length === 0) {
			return {
				ok: false,
				reason: `expected final text after runtime tool execution, got empty (finishReason: ${result.finishReason})`,
			};
		}
		if (!result.sessionMessages || result.sessionMessages.length < 2) {
			return {
				ok: false,
				reason: "expected runtime session messages to be persisted",
			};
		}

		return { ok: true };
	},
};
