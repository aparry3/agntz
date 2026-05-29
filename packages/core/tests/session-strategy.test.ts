import { describe, expect, it, vi } from "vitest";
import { defineAgent } from "../src/agent.js";
import { createRunner } from "../src/runner.js";
import { MemoryStore } from "../src/stores/memory.js";
import type { Message, ModelProvider } from "../src/types.js";

function createMockProvider(
	responses: string[] = ["Response."],
): ModelProvider {
	let callCount = 0;
	return {
		generateText: vi.fn().mockImplementation(async (opts: any) => {
			// Check if this is a summarization call
			const isSummary = opts.messages?.[0]?.content?.includes("summarizer");
			if (isSummary) {
				return {
					text: "Summary: Previous conversation about greetings and farewells.",
					usage: { promptTokens: 100, completionTokens: 30, totalTokens: 130 },
					finishReason: "stop",
				};
			}
			const text = responses[callCount % responses.length] || "Response.";
			callCount++;
			return {
				text,
				toolCalls: [],
				usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
				finishReason: "stop",
			};
		}),
	};
}

describe("Session strategy: sliding", () => {
	it("trims to maxMessages with sliding window", async () => {
		const store = new MemoryStore();
		const provider = createMockProvider(["Latest response."]);

		// Pre-populate session with many messages
		const sessionId = "sess_sliding";
		const messages: Message[] = [];
		for (let i = 0; i < 30; i++) {
			messages.push({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
				timestamp: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
			});
		}
		await store.append(sessionId, messages);

		const runner = createRunner({
			store,
			modelProvider: provider,
			session: { maxMessages: 10, strategy: "sliding" },
		});

		runner.registerAgent(
			defineAgent({
				id: "test",
				name: "Test",
				systemPrompt: "You are a test agent.",
				model: { provider: "mock", name: "mock" },
			}),
		);

		await runner.invoke("test", "Hello", { sessionId });

		// The model should have received at most 10 history messages + system + user
		const call = (provider.generateText as any).mock.calls[0][0];
		// system + 10 history + user = 12
		expect(call.messages.length).toBeLessThanOrEqual(12);
	});
});

describe("Session strategy: summary", () => {
	it("summarizes old messages and keeps recent ones", async () => {
		const store = new MemoryStore();
		const provider = createMockProvider(["Latest response."]);

		// Pre-populate session with many messages
		const sessionId = "sess_summary";
		const messages: Message[] = [];
		for (let i = 0; i < 30; i++) {
			messages.push({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
				timestamp: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
			});
		}
		await store.append(sessionId, messages);

		const runner = createRunner({
			store,
			modelProvider: provider,
			session: { maxMessages: 10, strategy: "summary" },
		});

		runner.registerAgent(
			defineAgent({
				id: "test",
				name: "Test",
				systemPrompt: "You are a test agent.",
				model: { provider: "mock", name: "mock" },
			}),
		);

		await runner.invoke("test", "Hello", { sessionId });

		// Should have called generateText twice: once for summary, once for actual invoke
		expect(provider.generateText).toHaveBeenCalledTimes(2);

		// First call should be the summarization
		const summaryCall = (provider.generateText as any).mock.calls[0][0];
		expect(summaryCall.messages[0].content).toContain("summarizer");

		// Second call should include the summary in history
		const invokeCall = (provider.generateText as any).mock.calls[1][0];
		const historyMessages = invokeCall.messages.filter(
			(m: any) => m.role !== "user" || m.content !== "Hello",
		);
		// Should include a system message with the summary
		const summaryMsg = invokeCall.messages.find((m: any) =>
			m.content?.includes("[Conversation Summary]"),
		);
		expect(summaryMsg).toBeDefined();
	});
});

describe("Session strategy: none", () => {
	it("returns all history without trimming", async () => {
		const store = new MemoryStore();
		const provider = createMockProvider(["Response."]);

		const sessionId = "sess_none";
		const messages: Message[] = [];
		for (let i = 0; i < 30; i++) {
			messages.push({
				role: i % 2 === 0 ? "user" : "assistant",
				content: `Message ${i}`,
				timestamp: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
			});
		}
		await store.append(sessionId, messages);

		const runner = createRunner({
			store,
			modelProvider: provider,
			session: { maxMessages: 10, strategy: "none" },
		});

		runner.registerAgent(
			defineAgent({
				id: "test",
				name: "Test",
				systemPrompt: "You are a test agent.",
				model: { provider: "mock", name: "mock" },
			}),
		);

		await runner.invoke("test", "Hello", { sessionId });

		// Should include all 30 messages (no trimming) + system + user
		const call = (provider.generateText as any).mock.calls[0][0];
		expect(call.messages.length).toBe(32); // 1 system + 30 history + 1 user
	});
});
