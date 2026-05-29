import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent.js";
import { createRunner } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
	ModelStreamResult,
	StreamEvent,
	TokenUsage,
} from "../src/types.js";

/**
 * Mock model provider that supports both generateText and streamText.
 */
class MockStreamProvider implements ModelProvider {
	private responses: GenerateTextResult[];
	private callIndex = 0;

	constructor(responses: GenerateTextResult | GenerateTextResult[]) {
		this.responses = Array.isArray(responses) ? responses : [responses];
	}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		const response =
			this.responses[this.callIndex] ??
			this.responses[this.responses.length - 1];
		this.callIndex++;
		return response;
	}

	async streamText(options: GenerateTextOptions): Promise<ModelStreamResult> {
		const response =
			this.responses[this.callIndex] ??
			this.responses[this.responses.length - 1];
		this.callIndex++;

		// Simulate streaming by splitting text into chunks
		const text = response.text;
		const chunks = text.match(/.{1,5}/g) ?? (text ? [text] : []);

		async function* textStream() {
			for (const chunk of chunks) {
				yield chunk;
			}
		}

		return {
			textStream: textStream(),
			toolCalls: Promise.resolve(response.toolCalls ?? []),
			usage: Promise.resolve(response.usage),
			finishReason: Promise.resolve(response.finishReason),
			async toResult(): Promise<GenerateTextResult> {
				return response;
			},
		};
	}
}

function mockResponse(text: string): GenerateTextResult {
	return {
		text,
		usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
		finishReason: "stop",
	};
}

describe("Streaming", () => {
	it("streams text deltas from an agent", async () => {
		const provider = new MockStreamProvider(mockResponse("Hello, world!"));
		const runner = createRunner({ modelProvider: provider });

		runner.registerAgent(
			defineAgent({
				id: "greeter",
				name: "Greeter",
				systemPrompt: "Greet people.",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		const stream = runner.stream("greeter", "Hi!");
		const events: StreamEvent[] = [];

		for await (const event of stream) {
			events.push(event);
		}

		// Should have text-delta events and a done event
		const textDeltas = events.filter((e) => e.type === "text-delta");
		expect(textDeltas.length).toBeGreaterThan(0);

		// Reconstruct text
		const fullText = textDeltas
			.map((e) => (e as { type: "text-delta"; text: string }).text)
			.join("");
		expect(fullText).toBe("Hello, world!");

		// Last event should be done
		const doneEvent = events[events.length - 1];
		expect(doneEvent.type).toBe("done");
		expect((doneEvent as { type: "done"; result: any }).result.output).toBe(
			"Hello, world!",
		);
	});

	it("stream.result resolves to the final InvokeResult", async () => {
		const provider = new MockStreamProvider(mockResponse("Test output"));
		const runner = createRunner({ modelProvider: provider });

		runner.registerAgent(
			defineAgent({
				id: "test",
				name: "Test",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		const stream = runner.stream("test", "Hello");

		// Consume the stream
		for await (const _ of stream) {
		}

		// Result should be available
		const result = await stream.result;
		expect(result.output).toBe("Test output");
		expect(result.model).toBe("openai/gpt-5.4");
	});

	it("streams with tool calls", async () => {
		const provider = new MockStreamProvider([
			// First call: tool call
			{
				text: "",
				toolCalls: [{ id: "call_1", name: "get_time", args: {} }],
				usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
				finishReason: "tool-calls",
			},
			// Second call: final text
			mockResponse("It's 10:42 PM."),
		]);

		const getTime = defineTool({
			name: "get_time",
			description: "Get the time",
			input: z.object({}),
			async execute() {
				return { time: "10:42 PM" };
			},
		});

		const runner = createRunner({ modelProvider: provider, tools: [getTime] });

		runner.registerAgent(
			defineAgent({
				id: "time",
				name: "Time",
				systemPrompt: "Tell time.",
				model: { provider: "openai", name: "gpt-5.4" },
				tools: [{ type: "inline", name: "get_time" }],
			}),
		);

		const stream = runner.stream("time", "What time is it?");
		const events: StreamEvent[] = [];

		for await (const event of stream) {
			events.push(event);
		}

		// Should have tool-call-start, tool-call-end, step-complete, text-delta(s), done
		const types = events.map((e) => e.type);
		expect(types).toContain("tool-call-start");
		expect(types).toContain("tool-call-end");
		expect(types).toContain("step-complete");
		expect(types).toContain("text-delta");
		expect(types[types.length - 1]).toBe("done");

		const result = await stream.result;
		expect(result.output).toBe("It's 10:42 PM.");
		expect(result.toolCalls).toHaveLength(1);
	});

	it("falls back to non-streaming when streamText not available", async () => {
		// Regular provider without streamText
		const provider: ModelProvider = {
			async generateText(): Promise<GenerateTextResult> {
				return mockResponse("Fallback text");
			},
		};

		const runner = createRunner({ modelProvider: provider });

		runner.registerAgent(
			defineAgent({
				id: "basic",
				name: "Basic",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		const stream = runner.stream("basic", "Hi");
		const events: StreamEvent[] = [];

		for await (const event of stream) {
			events.push(event);
		}

		// Should still get text-delta (single chunk) and done
		const textDeltas = events.filter((e) => e.type === "text-delta");
		expect(textDeltas.length).toBe(1);
		expect((textDeltas[0] as any).text).toBe("Fallback text");

		const result = await stream.result;
		expect(result.output).toBe("Fallback text");
	});
});
