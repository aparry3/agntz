import { describe, expect, it, vi } from "vitest";
import type { Message, ModelConfig, ModelProvider } from "../src/types.js";
import {
	summarizeMessages,
	trimHistoryWithSummary,
} from "../src/utils/summarize.js";

function makeMessage(
	role: "user" | "assistant",
	content: string,
	idx = 0,
): Message {
	return {
		role,
		content,
		timestamp: new Date(Date.now() - (100 - idx) * 60_000).toISOString(),
	};
}

function mockModelProvider(
	summaryText = "Summary of the conversation.",
): ModelProvider {
	return {
		generateText: vi.fn().mockResolvedValue({
			text: summaryText,
			usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
			finishReason: "stop",
		}),
	};
}

const modelConfig: ModelConfig = { provider: "openai", name: "gpt-5.4-mini" };

describe("summarizeMessages", () => {
	it("returns empty string for empty messages", async () => {
		const provider = mockModelProvider();
		const result = await summarizeMessages([], provider, modelConfig);
		expect(result).toBe("");
		expect(provider.generateText).not.toHaveBeenCalled();
	});

	it("calls model provider with conversation text", async () => {
		const provider = mockModelProvider("A user asked about TypeScript types.");
		const messages: Message[] = [
			makeMessage("user", "What are TypeScript generics?"),
			makeMessage(
				"assistant",
				"Generics allow you to create reusable components.",
			),
		];

		const result = await summarizeMessages(messages, provider, modelConfig);
		expect(result).toBe("A user asked about TypeScript types.");
		expect(provider.generateText).toHaveBeenCalledOnce();

		const call = (provider.generateText as any).mock.calls[0][0];
		expect(call.messages[0].role).toBe("system");
		expect(call.messages[0].content).toContain("summarizer");
		expect(call.messages[1].content).toContain("TypeScript generics");
	});

	it("filters out system messages", async () => {
		const provider = mockModelProvider("Summary.");
		const messages: Message[] = [
			{
				role: "system",
				content: "You are an assistant.",
				timestamp: new Date().toISOString(),
			},
			makeMessage("user", "Hello"),
			makeMessage("assistant", "Hi there!"),
		];

		await summarizeMessages(messages, provider, modelConfig);
		const call = (provider.generateText as any).mock.calls[0][0];
		expect(call.messages[1].content).not.toContain("You are an assistant");
		expect(call.messages[1].content).toContain("Hello");
	});

	it("passes abort signal through", async () => {
		const provider = mockModelProvider("Summary.");
		const controller = new AbortController();
		await summarizeMessages(
			[makeMessage("user", "test")],
			provider,
			modelConfig,
			controller.signal,
		);

		const call = (provider.generateText as any).mock.calls[0][0];
		expect(call.signal).toBe(controller.signal);
	});
});

describe("trimHistoryWithSummary", () => {
	it("returns messages as-is when under maxMessages", async () => {
		const provider = mockModelProvider();
		const messages = [
			makeMessage("user", "Hello", 0),
			makeMessage("assistant", "Hi", 1),
		];

		const result = await trimHistoryWithSummary(messages, {
			maxMessages: 10,
			modelProvider: provider,
			modelConfig,
		});

		expect(result).toEqual(messages);
		expect(provider.generateText).not.toHaveBeenCalled();
	});

	it("summarizes older messages and keeps recent ones", async () => {
		const provider = mockModelProvider("Previous topics: weather and food.");
		const messages: Message[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push(
				makeMessage(i % 2 === 0 ? "user" : "assistant", `Message ${i}`, i),
			);
		}

		const result = await trimHistoryWithSummary(messages, {
			maxMessages: 10,
			keepRecent: 6,
			modelProvider: provider,
			modelConfig,
		});

		// Should have 1 summary + 6 recent = 7 messages
		expect(result.length).toBe(7);
		expect(result[0].role).toBe("system");
		expect(result[0].content).toContain("[Conversation Summary]");
		expect(result[0].content).toContain("Previous topics: weather and food.");
		// Last 6 should be the most recent messages
		expect(result[6].content).toBe("Message 19");
		expect(result[1].content).toBe("Message 14");
	});

	it("uses 60% default for keepRecent", async () => {
		const provider = mockModelProvider("Summary.");
		const messages: Message[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push(
				makeMessage(i % 2 === 0 ? "user" : "assistant", `Msg ${i}`, i),
			);
		}

		const result = await trimHistoryWithSummary(messages, {
			maxMessages: 10,
			modelProvider: provider,
			modelConfig,
		});

		// 60% of 10 = 6 recent + 1 summary = 7
		expect(result.length).toBe(7);
		expect(result[0].role).toBe("system");
	});

	it("handles case where keepRecent covers all messages", async () => {
		const provider = mockModelProvider("Summary.");
		const messages: Message[] = [];
		for (let i = 0; i < 12; i++) {
			messages.push(
				makeMessage(i % 2 === 0 ? "user" : "assistant", `Msg ${i}`, i),
			);
		}

		const result = await trimHistoryWithSummary(messages, {
			maxMessages: 10,
			keepRecent: 12,
			modelProvider: provider,
			modelConfig,
		});

		// keepRecent >= messages.length → olderMessages is empty → just trim
		expect(result.length).toBe(10);
		expect(provider.generateText).not.toHaveBeenCalled();
	});

	it("detects existing summary and re-summarizes", async () => {
		const provider = mockModelProvider("Updated summary.");
		const messages: Message[] = [
			{
				role: "system",
				content: "[Conversation Summary]\nOld summary text.",
				timestamp: new Date().toISOString(),
			},
			...Array.from({ length: 15 }, (_, i) =>
				makeMessage(i % 2 === 0 ? "user" : "assistant", `Msg ${i}`, i),
			),
		];

		const result = await trimHistoryWithSummary(messages, {
			maxMessages: 10,
			keepRecent: 6,
			modelProvider: provider,
			modelConfig,
		});

		expect(result[0].role).toBe("system");
		expect(result[0].content).toContain("Updated summary");
		expect(provider.generateText).toHaveBeenCalledOnce();
	});
});
