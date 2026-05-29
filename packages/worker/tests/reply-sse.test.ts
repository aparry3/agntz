import {
	type GenerateTextOptions,
	type GenerateTextResult,
	InMemoryRunRegistry,
	MemoryStore,
	type ModelProvider,
	type Runner,
	createRunner,
	defineAgent,
} from "@agntz/core";
import type { AgentManifest, LLMAgentManifest } from "@agntz/manifest";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp(
	overrides: {
		resolveRunnerAndManifest?: (
			store: MemoryStore,
			userId: string,
			agentId: string,
		) => Promise<{ runner: Runner; manifest: AgentManifest }>;
	} = {},
) {
	const store = new MemoryStore();
	// Long grace so the run stays in-memory across the registry emit + SSE read.
	const runRegistry = new InMemoryRunRegistry({
		gracePeriodMs: 60_000,
		persistRun: async (run) => {
			if (run.userId) {
				await store
					.forUser(run.userId)
					.putRun(run)
					.catch(() => {});
			}
		},
	});
	const app = createWorkerAPI({
		store,
		internalSecret: SECRET,
		runRegistry,
		resolveRunnerAndManifest: overrides.resolveRunnerAndManifest as
			| ((
					s: import("@agntz/core").UnifiedStore,
					u: string,
					a: string,
			  ) => Promise<{ runner: Runner; manifest: AgentManifest }>)
			| undefined,
	});
	return { app, store, runRegistry };
}

/**
 * Deterministic provider that yields scripted responses. Identical shape to
 * the MockModelProvider used by core/tests/reply.test.ts.
 */
class MockModelProvider implements ModelProvider {
	private responses: GenerateTextResult[];
	private callIndex = 0;

	constructor(responses: GenerateTextResult[]) {
		this.responses = responses;
	}

	async generateText(_opts: GenerateTextOptions): Promise<GenerateTextResult> {
		const r =
			this.responses[this.callIndex] ??
			this.responses[this.responses.length - 1];
		this.callIndex++;
		return r;
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

/**
 * Parse an SSE byte stream into an array of typed frames. Stops once the
 * registry's terminal event closes the subscription (or `maxFrames` is hit).
 * Intentionally minimal — just enough to assert event ordering in tests.
 */
async function readSseFrames(
	res: Response,
	maxFrames = 50,
): Promise<Array<{ event?: string; data: string; id?: string }>> {
	const reader = res.body?.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const frames: Array<{ event?: string; data: string; id?: string }> = [];
	while (frames.length < maxFrames) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		// SSE frames are separated by a blank line.
		let idx: number;
		while ((idx = buffer.indexOf("\n\n")) >= 0) {
			const block = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			const frame: { event?: string; data: string; id?: string } = { data: "" };
			for (const line of block.split("\n")) {
				if (line.startsWith("event:")) frame.event = line.slice(6).trim();
				else if (line.startsWith("data:")) {
					frame.data =
						(frame.data ? `${frame.data}\n` : "") + line.slice(5).trim();
				} else if (line.startsWith("id:")) frame.id = line.slice(3).trim();
			}
			frames.push(frame);
		}
	}
	reader.cancel().catch(() => {});
	return frames;
}

describe("GET /runs/:id/stream — reply events flow through the multiplexed feed", () => {
	it("forwards `reply` MultiplexedEvent frames to SSE consumers", async () => {
		const { app, store, runRegistry } = makeApp();
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		// Create a Run directly on the registry so we have a known rootId to
		// emit events against. Bypasses runner.invoke() — we only need to test
		// the route's forwarding logic.
		const run = runRegistry.create({
			agentId: "a1",
			input: "go",
			userId: "u1",
			sessionId: "sess-1",
		});

		// Pre-emit a reply before any subscriber attaches. The registry buffers
		// events and replays them on subscribe, so this should still be visible.
		runRegistry.emit(run.rootId, {
			type: "reply",
			runId: run.id,
			sessionId: "sess-1",
			text: "still thinking...",
			ts: "2026-05-16T12:00:00.000Z",
			seq: 0, // placeholder; the registry stamps the real seq
		});

		// Subscribe via the SSE endpoint. Kick off a short read loop, then emit
		// a second reply + a terminal `run-complete` to close the stream.
		const reqPromise = app.request(`/runs/${run.id}/stream`, {
			method: "GET",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		// Yield so the handler attaches the subscriber before we emit more.
		await new Promise((r) => setTimeout(r, 5));

		runRegistry.emit(run.rootId, {
			type: "reply",
			runId: run.id,
			sessionId: "sess-1",
			text: "almost there",
			ts: "2026-05-16T12:00:01.000Z",
			seq: 0,
		});

		// Terminate the run so the subscription closes cleanly. The route
		// forwards every multiplexed event including the terminal one, so the
		// SSE reader sees `run-complete` and the body stream ends.
		runRegistry.notifyCompleted(run.id, {
			output: "done",
			invocationId: run.id,
			sessionId: "sess-1",
			toolCalls: [],
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			duration: 0,
			model: "stub",
		});

		const res = await reqPromise;
		expect(res.status).toBe(200);

		const frames = await readSseFrames(res);
		const replyFrames = frames.filter((f) => f.event === "reply");
		expect(replyFrames.length).toBeGreaterThanOrEqual(2);
		const texts = replyFrames.map((f) => JSON.parse(f.data).text as string);
		expect(texts).toEqual(
			expect.arrayContaining(["still thinking...", "almost there"]),
		);

		// Each reply frame has a numeric `id` matching the canonical seq stamped
		// by the registry — wire format the SDK uses for resume-on-reconnect.
		for (const f of replyFrames) {
			expect(f.id).toBeDefined();
			expect(Number.isFinite(Number(f.id))).toBe(true);
		}

		// The terminal frame closes the stream.
		const terminal = frames.find((f) => f.event === "run-complete");
		expect(terminal).toBeDefined();
	});
});

describe("POST /run/stream — reply events on the wire", () => {
	it("emits a `reply` SSE event for each accepted reply during the run", async () => {
		// LLM manifest that calls reply twice then returns a final answer.
		const provider = new MockModelProvider([
			replyCall("tc1", "still thinking..."),
			replyCall("tc2", "almost there"),
			finalText("done!"),
		]);

		const buildRunner = (): Runner => {
			const runner = createRunner({
				modelProvider: provider,
				store: new MemoryStore(),
			});
			runner.registerAgent(
				defineAgent({
					id: "with-reply",
					name: "With Reply",
					systemPrompt: "test",
					model: { provider: "openai", name: "gpt-5.4" },
					reply: true,
				}),
			);
			return runner;
		};

		const manifest: LLMAgentManifest = {
			kind: "llm",
			id: "with-reply",
			name: "With Reply",
			instruction: "test",
			model: { provider: "openai", name: "gpt-5.4" },
			reply: true,
		};

		const { app, store } = makeApp({
			resolveRunnerAndManifest: async () => ({
				runner: buildRunner(),
				manifest,
			}),
		});
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const res = await app.request("/run/stream", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${rawKey}`,
			},
			body: JSON.stringify({ agentId: "with-reply", input: "go" }),
		});
		expect(res.status).toBe(200);

		const frames = await readSseFrames(res);

		// First frame is `run-start` and the last is `run-complete`.
		expect(frames[0]?.event).toBe("run-start");
		const lastFrame = frames[frames.length - 1];
		expect(lastFrame?.event).toBe("run-complete");

		// Two `reply` SSE frames in between, with the original text payloads.
		const replyFrames = frames.filter((f) => f.event === "reply");
		expect(replyFrames).toHaveLength(2);
		expect(replyFrames.map((f) => JSON.parse(f.data).text)).toEqual([
			"still thinking...",
			"almost there",
		]);

		// Replies are also aggregated onto the final `run-complete` payload so
		// batch consumers still see them — additive, not a replacement.
		const completePayload = JSON.parse(lastFrame?.data);
		expect(completePayload.replies).toHaveLength(2);
		expect(completePayload.replies[0].text).toBe("still thinking...");
		expect(completePayload.replies[1].text).toBe("almost there");
		expect(completePayload.output).toBe("done!");
	});

	it("emits zero `reply` SSE events when the agent doesn't use the reply tool", async () => {
		const provider = new MockModelProvider([finalText("hi there")]);

		const buildRunner = (): Runner => {
			const runner = createRunner({
				modelProvider: provider,
				store: new MemoryStore(),
			});
			runner.registerAgent(
				defineAgent({
					id: "no-reply",
					name: "No Reply",
					systemPrompt: "test",
					model: { provider: "openai", name: "gpt-5.4" },
				}),
			);
			return runner;
		};

		const manifest: LLMAgentManifest = {
			kind: "llm",
			id: "no-reply",
			name: "No Reply",
			instruction: "test",
			model: { provider: "openai", name: "gpt-5.4" },
		};

		const { app, store } = makeApp({
			resolveRunnerAndManifest: async () => ({
				runner: buildRunner(),
				manifest,
			}),
		});
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const res = await app.request("/run/stream", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${rawKey}`,
			},
			body: JSON.stringify({ agentId: "no-reply", input: "go" }),
		});
		expect(res.status).toBe(200);

		const frames = await readSseFrames(res);
		expect(frames.filter((f) => f.event === "reply")).toHaveLength(0);
		const last = frames[frames.length - 1];
		expect(last?.event).toBe("run-complete");
		expect(JSON.parse(last?.data).replies).toBeUndefined();
	});
});

describe("GET /runs/:id/stream — canonical seq", () => {
	it("preserves canonical seq numbers for reply events on the wire (smoke)", async () => {
		// SSE consumers use the `id` field (== registry-stamped `seq`) to resume
		// after a reconnect. This test pins down that reply frames carry the
		// numerical seq in their `id` line, matching the seq in the data payload.
		const { app, store, runRegistry } = makeApp();
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });
		const run = runRegistry.create({
			agentId: "a1",
			input: "go",
			userId: "u1",
			sessionId: "sess-2",
		});

		const reqPromise = app.request(`/runs/${run.id}/stream`, {
			method: "GET",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		await new Promise((r) => setTimeout(r, 5));

		runRegistry.emit(run.rootId, {
			type: "reply",
			runId: run.id,
			sessionId: "sess-2",
			text: "msg",
			ts: "2026-05-16T12:00:00.000Z",
			seq: 0,
		});
		runRegistry.notifyCompleted(run.id, {
			output: "done",
			invocationId: run.id,
			sessionId: "sess-2",
			toolCalls: [],
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			duration: 0,
			model: "stub",
		});

		const res = await reqPromise;
		const frames = await readSseFrames(res);
		const replyFrame = frames.find((f) => f.event === "reply");
		expect(replyFrame).toBeDefined();
		const data = JSON.parse(replyFrame?.data);
		// The id line and the seq inside the JSON payload must agree.
		expect(Number(replyFrame?.id)).toBe(data.seq);
		expect(typeof data.seq).toBe("number");
		expect(data.seq).toBeGreaterThan(0);
	});
});
