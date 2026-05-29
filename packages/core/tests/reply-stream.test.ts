import { describe, expect, it } from "vitest";
import { defineAgent } from "../src/agent.js";
import { createRunner } from "../src/runner.js";
import { MemoryStore } from "../src/stores/memory.js";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
	ModelStreamResult,
	StreamEvent,
} from "../src/types.js";

/**
 * Mock provider that supports both `generateText` and `streamText`. Yields
 * each scripted response in order; text is chunked into 5-char slices so we
 * exercise the real streaming path. Identical shape to `streaming.test.ts`'s
 * MockStreamProvider but with deterministic tool-call scripting.
 */
class MockStreamProvider implements ModelProvider {
	private responses: GenerateTextResult[];
	private callIndex = 0;

	constructor(responses: GenerateTextResult[]) {
		this.responses = responses;
	}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		const r =
			this.responses[this.callIndex] ??
			this.responses[this.responses.length - 1];
		this.callIndex++;
		return r;
	}

	async streamText(options: GenerateTextOptions): Promise<ModelStreamResult> {
		const response =
			this.responses[this.callIndex] ??
			this.responses[this.responses.length - 1];
		this.callIndex++;
		const text = response.text;
		const chunks = text.match(/.{1,5}/g) ?? (text ? [text] : []);
		async function* textStream() {
			for (const chunk of chunks) yield chunk;
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

function replyCall(id: string, text: string): GenerateTextResult {
	return {
		text: "",
		toolCalls: [{ id, name: "reply", args: { text } }],
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		finishReason: "tool-calls",
	};
}

function finalText(text: string): GenerateTextResult {
	return {
		text,
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		finishReason: "stop",
	};
}

describe("Runner.stream reply events", () => {
	it("yields a `reply` StreamEvent for each accepted reply, interleaved with tool events", async () => {
		const provider = new MockStreamProvider([
			replyCall("tc1", "still thinking..."),
			replyCall("tc2", "almost there"),
			finalText("done!"),
		]);
		const store = new MemoryStore().forUser("u1");
		const runner = createRunner({ modelProvider: provider, store });
		runner.registerAgent(
			defineAgent({
				id: "agent",
				name: "Agent",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
				reply: true,
			}),
		);

		const stream = runner.stream("agent", "go", { userId: "u1" });
		const events: StreamEvent[] = [];
		for await (const ev of stream) events.push(ev);

		// Two reply events should appear, in order.
		const replyEvents = events.filter((e) => e.type === "reply") as Extract<
			StreamEvent,
			{ type: "reply" }
		>[];
		expect(replyEvents).toHaveLength(2);
		expect(replyEvents[0].text).toBe("still thinking...");
		expect(replyEvents[1].text).toBe("almost there");
		expect(replyEvents[0].runId).toBeDefined();
		expect(replyEvents[0].sessionId).toBeDefined();
		expect(typeof replyEvents[0].ts).toBe("string");

		// Each reply event should appear AFTER the corresponding `tool-call-end`
		// for the reply tool and BEFORE the next `step-complete`. This pins down
		// the chronological ordering the stream contract promises.
		const idxFirstReplyEnd = events.findIndex(
			(e) => e.type === "tool-call-end" && (e as any).toolCall.name === "reply",
		);
		const idxFirstReplyEvent = events.findIndex((e) => e.type === "reply");
		expect(idxFirstReplyEvent).toBeGreaterThan(idxFirstReplyEnd);
		const idxFirstStepComplete = events.findIndex(
			(e) => e.type === "step-complete",
		);
		expect(idxFirstReplyEvent).toBeLessThan(idxFirstStepComplete);

		// The final `done` event should still carry the aggregated `replies`.
		const done = events[events.length - 1] as Extract<
			StreamEvent,
			{ type: "done" }
		>;
		expect(done.type).toBe("done");
		expect(done.result.replies).toHaveLength(2);
		expect(done.result.replies?.[0].text).toBe("still thinking...");
		expect(done.result.replies?.[1].text).toBe("almost there");
	});

	it("does NOT yield reply events when agent.reply is unset", async () => {
		// Without `reply: true` on the agent the runner doesn't register the
		// synthetic reply tool, so the model never gets a chance to call it.
		// Stream should look like a plain text-only run.
		const provider = new MockStreamProvider([finalText("hi there")]);
		const runner = createRunner({ modelProvider: provider });
		runner.registerAgent(
			defineAgent({
				id: "agent-no-reply",
				name: "Agent",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
			}),
		);

		const stream = runner.stream("agent-no-reply", "go");
		const events: StreamEvent[] = [];
		for await (const ev of stream) events.push(ev);

		expect(events.filter((e) => e.type === "reply")).toHaveLength(0);
		const done = events[events.length - 1] as Extract<
			StreamEvent,
			{ type: "done" }
		>;
		expect(done.type).toBe("done");
		expect(done.result.replies).toBeUndefined();
	});

	it("reply events carry the canonical sessionId and a non-empty runId", async () => {
		const provider = new MockStreamProvider([
			replyCall("tc1", "checking..."),
			finalText("final"),
		]);
		const store = new MemoryStore().forUser("u1");
		const runner = createRunner({ modelProvider: provider, store });
		runner.registerAgent(
			defineAgent({
				id: "agent",
				name: "Agent",
				systemPrompt: "test",
				model: { provider: "openai", name: "gpt-5.4" },
				reply: true,
			}),
		);

		const stream = runner.stream("agent", "go", {
			userId: "u1",
			sessionId: "sess-stream-1",
		});
		const events: StreamEvent[] = [];
		for await (const ev of stream) events.push(ev);

		const reply = events.find((e) => e.type === "reply") as Extract<
			StreamEvent,
			{ type: "reply" }
		>;
		expect(reply.sessionId).toBe("sess-stream-1");
		expect(reply.runId.length).toBeGreaterThan(0);
	});
});
