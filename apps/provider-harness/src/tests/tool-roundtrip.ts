import type { HarnessMessage, TestDefinition } from "../types.js";
import { WEATHER_TOOL, modelConfig } from "./_helpers.js";

export const toolRoundtrip: TestDefinition = {
	id: "tool-roundtrip",
	capability: "tools",
	timeoutMs: 60_000,
	async run(model, ctx) {
		const mc = modelConfig(model);

		const firstMessages: HarnessMessage[] = [
			{
				role: "user",
				content:
					"What is the weather in Paris? You must call the get_weather tool to find out.",
			},
		];

		const first = await ctx.adapter.generateText({
			model: mc,
			messages: firstMessages,
			tools: [WEATHER_TOOL],
			maxTokens: 1024,
			signal: ctx.abortSignal,
		});

		if (!first.toolCalls || first.toolCalls.length === 0) {
			return {
				ok: false,
				reason: `expected a tool call on turn 1, got none (finishReason: ${first.finishReason})`,
			};
		}
		const call = first.toolCalls[0];
		if (call.name !== WEATHER_TOOL.name) {
			return {
				ok: false,
				reason: `expected tool "${WEATHER_TOOL.name}", got "${call.name}"`,
			};
		}

		const assistantResponseMessages =
			first.responseMessages && first.responseMessages.length > 0
				? first.responseMessages
				: [
						{
							role: "assistant",
							content: first.toolCalls.map((tc) => ({
								type: "tool-call" as const,
								toolCallId: tc.id,
								toolName: tc.name,
								input: tc.args,
								// Echo provider metadata (e.g. Gemini thought_signature) back so
								// the follow-up turn is accepted.
								...(tc.providerMetadata != null
									? { providerOptions: tc.providerMetadata }
									: {}),
							})),
						},
					];

		// Replay the provider-normalized assistant response messages. This is the
		// shape @agntz/core's runner uses; it preserves provider-specific parts
		// such as OpenAI reasoning item references and Gemini thought signatures.
		const followupMessages: HarnessMessage[] = [
			...firstMessages,
			...assistantResponseMessages,
			...first.toolCalls.map((tc) =>
				ctx.sdk === "python"
					? {
							role: "tool",
							content: "18°C and sunny",
							tool_call_id: tc.id,
						}
					: {
							role: "tool",
							content: [
								{
									type: "tool-result" as const,
									toolCallId: tc.id,
									toolName: tc.name,
									output: { type: "text" as const, value: "18°C and sunny" },
								},
							],
						},
			),
		];

		const second = await ctx.adapter.generateText({
			model: mc,
			messages: followupMessages,
			tools: [WEATHER_TOOL],
			maxTokens: 1024,
			signal: ctx.abortSignal,
		});

		if (typeof second.text !== "string" || second.text.trim().length === 0) {
			return {
				ok: false,
				reason: `expected final text after tool result, got empty (finishReason: ${second.finishReason})`,
			};
		}

		return {
			ok: true,
			snapshot: {
				normalizedToolCall: first.toolCalls,
				followupMessages,
			},
		};
	},
};
