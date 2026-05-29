import { describe, expect, it } from "vitest";
import {
	AgntzClient,
	type Span,
	type TraceLiveEvent,
	type TraceSummary,
} from "../src/index.js";
import { jsonResponse, mockFetch, sseResponse } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

function sampleSummary(overrides: Partial<TraceSummary> = {}): TraceSummary {
	return {
		traceId: "tr_1",
		ownerId: "u1",
		rootName: "manifest",
		agentId: "a1",
		startedAt: "2026-05-11T12:00:00.000Z",
		endedAt: "2026-05-11T12:00:01.000Z",
		durationMs: 1000,
		spanCount: 1,
		status: "ok",
		totalTokens: 0,
		totalCostUsd: null,
		...overrides,
	};
}

function sampleSpan(overrides: Partial<Span> = {}): Span {
	return {
		spanId: "sp_root",
		traceId: "tr_1",
		parentId: null,
		ownerId: "u1",
		runId: null,
		sessionId: null,
		name: "manifest",
		kind: "manifest",
		startedAt: "2026-05-11T12:00:00.000Z",
		endedAt: "2026-05-11T12:00:01.000Z",
		durationMs: 1000,
		status: "ok",
		error: null,
		attributes: {},
		events: [],
		scores: {},
		costUsd: null,
		...overrides,
	};
}

describe("AgntzClient.traces.list", () => {
	it("GET /traces with query params and Bearer", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, { rows: [sampleSummary()] }),
		);
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const out = await client.traces.list({ agentId: "a1", limit: 10 });
		expect(out.rows).toHaveLength(1);
		expect(mock.calls[0]?.url).toBe(`${BASE}/traces?agentId=a1&limit=10`);
		expect(
			(mock.calls[0]?.init.headers as Record<string, string>).Authorization,
		).toBe("Bearer k");
	});

	it("omits query string when no filter is given", async () => {
		const mock = mockFetch(() => jsonResponse(200, { rows: [] }));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		await client.traces.list();
		expect(mock.calls[0]?.url).toBe(`${BASE}/traces`);
	});
});

describe("AgntzClient.traces.get", () => {
	it("GET /traces/:id and returns { summary, spans }", async () => {
		const summary = sampleSummary();
		const spans = [sampleSpan()];
		const mock = mockFetch(() => jsonResponse(200, { summary, spans }));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const out = await client.traces.get("tr_1");
		expect(out).toEqual({ summary, spans });
		expect(mock.calls[0]?.url).toBe(`${BASE}/traces/tr_1`);
	});

	it("URL-encodes the traceId", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, { summary: sampleSummary(), spans: [] }),
		);
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		await client.traces.get("tr/has slash");
		expect(mock.calls[0]?.url).toBe(`${BASE}/traces/tr%2Fhas%20slash`);
	});
});

describe("AgntzClient.traces.delete", () => {
	it("DELETE /traces/:id resolves on 204", async () => {
		const mock = mockFetch(() => new Response(null, { status: 204 }));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		await client.traces.delete("tr_1");
		expect(mock.calls[0]?.url).toBe(`${BASE}/traces/tr_1`);
		expect(mock.calls[0]?.init.method).toBe("DELETE");
	});
});

describe("AgntzClient.traces.stream", () => {
	it("yields snapshot frame and closes for terminal trace", async () => {
		const summary = sampleSummary();
		const spans = [sampleSpan()];
		const chunks = [
			`event: snapshot\ndata: ${JSON.stringify({ summary, spans })}\n\n`,
		];
		const mock = mockFetch(() => sseResponse(chunks));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const collected: TraceLiveEvent[] = [];
		for await (const ev of client.traces.stream("tr_1")) collected.push(ev);
		expect(collected).toEqual([{ type: "snapshot", summary, spans }]);
	});

	it("yields live span-start / span-end / trace-done in order", async () => {
		const summary = sampleSummary();
		const span = sampleSpan();
		const chunks = [
			`event: span-start\ndata: ${JSON.stringify({ type: "span-start", span })}\n\n`,
			`event: span-end\ndata: ${JSON.stringify({ type: "span-end", spanId: span.spanId, patch: { status: "ok" as const } })}\n\n`,
			`event: trace-done\ndata: ${JSON.stringify({ type: "trace-done", summary })}\n\n`,
		];
		const mock = mockFetch(() => sseResponse(chunks));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const collected: TraceLiveEvent[] = [];
		for await (const ev of client.traces.stream("tr_1")) collected.push(ev);
		expect(collected.map((e) => e.type)).toEqual([
			"span-start",
			"span-end",
			"trace-done",
		]);
	});
});
