import { describe, expect, it, vi } from "vitest";
import { AgntzClient, type StreamEvent } from "../src/index.js";
import { jsonResponse, mockFetch, sseResponse } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

function attachedFrames() {
	const deadlineAt = new Date(Date.now() + 30_000).toISOString();
	return [
		'event: run-start\ndata: {"agentId":"a1","kind":"llm","runId":"run_1"}\n\n',
		`event: client-tool-request\ndata: ${JSON.stringify({
			type: "client-tool-request",
			requestId: "ctr_1",
			rootRunId: "run_1",
			runId: "run_child_1",
			toolCallId: "call_1",
			name: "get_selection",
			input: { includeText: true },
			deadlineAt,
			seq: 2,
		})}\n\n`,
		'event: run-complete\ndata: {"output":"done","state":{},"runId":"run_1","status":"completed","model":"openai/gpt-5.4","usage":{"inputTokens":1,"outputTokens":1,"totalTokens":2}}\n\n',
	];
}

describe("attached client tools", () => {
	it("handles the SSE callback and returns one agents.run promise", async () => {
		const handler = vi.fn(
			async (input: unknown, context: { toolCallId: string }) => {
				expect(context.toolCallId).toBe("call_1");
				return { selected: "chapter one", input };
			},
		);
		const mock = mockFetch((url, init) => {
			if (url === `${BASE}/run/stream`) return sseResponse(attachedFrames());
			expect(url).toBe(`${BASE}/runs/run_1/client-tool-requests/ctr_1/result`);
			expect(JSON.parse(init.body as string)).toEqual({
				output: {
					selected: "chapter one",
					input: { includeText: true },
				},
			});
			return jsonResponse(202, { status: "accepted" });
		});
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});

		const result = await client.agents.run({
			agentId: "a1",
			clientTools: { get_selection: handler },
		});

		expect(result.output).toBe("done");
		expect(handler).toHaveBeenCalledOnce();
		expect(mock.calls).toHaveLength(2);
		expect(JSON.parse(mock.calls[0]!.init.body as string)).toMatchObject({
			agentId: "a1",
			clientTools: ["get_selection"],
		});
	});

	it("hides internal client-tool requests from agents.stream consumers", async () => {
		const mock = mockFetch((url) =>
			url === `${BASE}/run/stream`
				? sseResponse(attachedFrames())
				: jsonResponse(202, { status: "accepted" }),
		);
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const events: StreamEvent[] = [];
		for await (const event of client.agents.stream({
			agentId: "a1",
			clientTools: { get_selection: () => ({ selected: true }) },
		})) {
			events.push(event);
		}

		expect(events.map((event) => event.type)).toEqual(["start", "complete"]);
	});

	it("posts handler failures as tool errors instead of failing the SDK request", async () => {
		const mock = mockFetch((url, init) => {
			if (url === `${BASE}/run/stream`) return sseResponse(attachedFrames());
			expect(JSON.parse(init.body as string)).toEqual({
				error: "app exploded",
			});
			return jsonResponse(202, { status: "accepted" });
		});
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});

		const result = await client.agents.run({
			agentId: "a1",
			clientTools: {
				get_selection: () => {
					throw new Error("app exploded");
				},
			},
		});
		expect(result.output).toBe("done");
	});
});
