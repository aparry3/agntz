import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISDKModelProvider } from "../src/model-provider.js";

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	createCohere: vi.fn(() => vi.fn(() => ({ provider: "cohere-test" }))),
	createOpenAI: vi.fn(() => vi.fn(() => ({ provider: "openai-test" }))),
}));

vi.mock("ai", () => ({
	generateText: mocks.generateText,
	tool: (config: unknown) => ({ type: "function", config }),
	Output: {},
	jsonSchema: (schema: unknown) => schema,
}));

vi.mock("@ai-sdk/cohere", () => ({
	createCohere: mocks.createCohere,
}));

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: mocks.createOpenAI,
}));

describe("AISDKModelProvider", () => {
	beforeEach(() => {
		mocks.generateText.mockReset();
		mocks.createCohere.mockClear();
		mocks.createOpenAI.mockClear();
	});

	it("forwards common and provider-scoped model settings", async () => {
		mocks.generateText.mockResolvedValueOnce({
			text: "ok",
			response: {
				id: "response_123",
				modelId: "gpt-actual",
				messages: [],
			},
			usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
			finishReason: "stop",
			rawFinishReason: "stop",
			warnings: [],
		});

		const provider = new AISDKModelProvider();
		const result = await provider.generateText({
			model: {
				provider: "openai",
				name: "gpt-requested",
				temperature: 0,
				topP: 0.8,
				topK: 20,
				presencePenalty: 0.2,
				frequencyPenalty: -0.1,
				stopSequences: ["END"],
				seed: 7,
				maxRetries: 1,
				maxTokens: 900,
				providerOptions: {
					openai: {
						reasoningEffort: "medium",
						textVerbosity: "low",
						store: false,
					},
				},
			},
			messages: [{ role: "user", content: "hello" }],
		});

		expect(mocks.generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				maxOutputTokens: 900,
				temperature: 0,
				topP: 0.8,
				topK: 20,
				presencePenalty: 0.2,
				frequencyPenalty: -0.1,
				stopSequences: ["END"],
				seed: 7,
				maxRetries: 1,
				providerOptions: {
					openai: {
						reasoningEffort: "medium",
						textVerbosity: "low",
						store: false,
					},
				},
			}),
		);
		expect(result).toMatchObject({
			provider: "openai",
			requestedModel: "gpt-requested",
			model: "gpt-actual",
			responseId: "response_123",
			usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
		});
	});

	it("recovers Cohere tool-result responses rejected by the AI SDK citation schema", async () => {
		const err = new Error("Invalid JSON response") as Error & {
			cause?: unknown;
			responseBody?: string;
		};
		err.name = "AI_APICallError";
		err.cause = {
			name: "AI_TypeValidationError",
			value: {
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "It is sunny in Paris.",
						},
					],
					citations: [
						{
							start: 6,
							end: 11,
							text: "sunny",
							sources: [
								{
									type: "tool",
									id: "call_1:0",
									tool_output: { city: "Paris", condition: "sunny" },
								},
							],
						},
					],
				},
				finish_reason: "COMPLETE",
				usage: {
					tokens: { input_tokens: 100, output_tokens: 12 },
					cached_tokens: 7,
				},
			},
		};
		mocks.generateText.mockRejectedValueOnce(err);

		const provider = new AISDKModelProvider();
		const result = await provider.generateText({
			model: { provider: "cohere", name: "command-a-03-2025" },
			messages: [{ role: "user", content: "What is the weather in Paris?" }],
			tools: [
				{
					name: "get_weather",
					description: "Get the current weather for a city.",
					parameters: {
						type: "object",
						properties: { city: { type: "string" } },
						required: ["city"],
					},
				},
			],
		});

		expect(result).toMatchObject({
			text: "It is sunny in Paris.",
			toolCalls: [],
			usage: {
				promptTokens: 100,
				completionTokens: 12,
				totalTokens: 112,
				cachedInputTokens: 7,
				inputTokenDetails: { cacheReadTokens: 7 },
			},
			finishReason: "stop",
			responseMessages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "It is sunny in Paris." }],
				},
			],
		});
	});
});
