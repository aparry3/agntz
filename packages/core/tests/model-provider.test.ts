import { beforeEach, describe, expect, it, vi } from "vitest";
import { AISDKModelProvider } from "../src/model-provider.js";

const mocks = vi.hoisted(() => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	outputObject: vi.fn((config: unknown) => ({ type: "object", config })),
	createCohere: vi.fn(() => vi.fn(() => ({ provider: "cohere-test" }))),
	createOpenAI: vi.fn(() => vi.fn(() => ({ provider: "openai-test" }))),
}));

vi.mock("ai", () => ({
	generateText: mocks.generateText,
	streamText: mocks.streamText,
	tool: (config: unknown) => ({ type: "function", config }),
	Output: { object: mocks.outputObject },
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
		mocks.streamText.mockReset();
		mocks.outputObject.mockClear();
		mocks.createCohere.mockClear();
		mocks.createOpenAI.mockClear();
	});

	it("passes system messages through the AI SDK instructions option", async () => {
		mocks.generateText.mockResolvedValueOnce({
			text: "ok",
			response: { id: "response_123", modelId: "gpt-5.6-terra", messages: [] },
			usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
			finishReason: "stop",
			rawFinishReason: "stop",
			warnings: [],
		});

		const provider = new AISDKModelProvider();
		await provider.generateText({
			model: { provider: "openai", name: "gpt-5.6-terra" },
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "First question" },
				{ role: "assistant", content: "First answer" },
				{ role: "system", content: "[Conversation Summary] Earlier context" },
				{ role: "user", content: "Follow-up question" },
			],
		});

		expect(mocks.generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				instructions: [
					{ role: "system", content: "You are a helpful assistant." },
					{
						role: "system",
						content: "[Conversation Summary] Earlier context",
					},
				],
				messages: [
					{ role: "user", content: "First question" },
					{ role: "assistant", content: "First answer" },
					{ role: "user", content: "Follow-up question" },
				],
			}),
		);
	});

	it("passes system messages through instructions when streaming", async () => {
		mocks.streamText.mockReturnValueOnce({
			textStream: {
				async *[Symbol.asyncIterator]() {
					yield "ok";
				},
			},
			text: Promise.resolve("ok"),
			toolCalls: Promise.resolve([]),
			usage: Promise.resolve({
				inputTokens: 5,
				outputTokens: 2,
				totalTokens: 7,
			}),
			finishReason: Promise.resolve("stop"),
			rawFinishReason: Promise.resolve("stop"),
			providerMetadata: Promise.resolve(undefined),
			response: Promise.resolve({
				id: "response_123",
				modelId: "gpt-5.6-terra",
				messages: [],
			}),
			warnings: Promise.resolve([]),
		});

		const provider = new AISDKModelProvider();
		await provider.streamText({
			model: { provider: "openai", name: "gpt-5.6-terra" },
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello" },
			],
		});

		expect(mocks.streamText).toHaveBeenCalledWith(
			expect.objectContaining({
				instructions: [
					{ role: "system", content: "You are a helpful assistant." },
				],
				messages: [{ role: "user", content: "Hello" }],
			}),
		);
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

	it("uses the AI SDK 7 output API for structured responses", async () => {
		mocks.generateText.mockResolvedValueOnce({
			text: '{"answer":"ok"}',
			response: { id: "response_456", modelId: "gpt-5.6-terra", messages: [] },
			usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
			finishReason: "stop",
			rawFinishReason: "stop",
			warnings: [],
		});

		const schema = {
			type: "object",
			properties: { answer: { type: "string" } },
			required: ["answer"],
		};
		const provider = new AISDKModelProvider();
		await provider.generateText({
			model: { provider: "openai", name: "gpt-5.6-terra" },
			messages: [{ role: "user", content: "hello" }],
			outputSchema: { name: "answer", schema },
		});

		expect(mocks.outputObject).toHaveBeenCalledWith({ name: "answer", schema });
		expect(mocks.generateText).toHaveBeenCalledWith(
			expect.objectContaining({
				output: { type: "object", config: { name: "answer", schema } },
			}),
		);
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
