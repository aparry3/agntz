import type { TestDefinition } from "../types.js";
import {
	WEATHER_TOOL,
	consumeStream,
	modelConfig,
	requireStreaming,
} from "./_helpers.js";

export const streamingTools: TestDefinition = {
	id: "streaming-tools",
	capability: "streamingTools",
	async run(model, ctx) {
		const skip = requireStreaming(ctx);
		if (skip) return skip;
		const stream = await ctx.adapter.streamText!({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content: "What is the weather in Paris? Use the get_weather tool.",
				},
			],
			tools: [WEATHER_TOOL],
			// Generous budget so reasoning models have room to think and still emit
			// the tool call rather than exhausting tokens mid-reasoning.
			maxTokens: 1024,
			signal: ctx.abortSignal,
		});

		const consumed = await consumeStream(stream);

		if (consumed.streamError) throw consumed.streamError;
		if (consumed.toolCalls.length === 0) {
			return {
				ok: false,
				reason: `expected >=1 tool call via stream, got 0 (finishReason: ${consumed.finishReason})`,
			};
		}
		const call = consumed.toolCalls[0];
		if (call.name !== WEATHER_TOOL.name) {
			return {
				ok: false,
				reason: `expected tool "${WEATHER_TOOL.name}", got "${call.name}"`,
			};
		}
		if (consumed.responseMessages) {
			const hasToolCallResponsePart = consumed.responseMessages.some(
				(message) =>
					message.role === "assistant" &&
					Array.isArray(message.content) &&
					message.content.some(
						(part) =>
							part &&
							typeof part === "object" &&
							"type" in part &&
							part.type === "tool-call",
					),
			);
			if (!hasToolCallResponsePart) {
				return {
					ok: false,
					reason:
						"expected streaming responseMessages to include an assistant tool-call part",
				};
			}
		}
		return { ok: true };
	},
};
