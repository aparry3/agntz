import { describe, expect, it } from "vitest";
import { normalizeTraceLiveEvent } from "../src/events.js";
import type { Span, TraceLiveEvent, TraceSummary } from "../src/index.js";

function sampleSpan(): Span {
	return {
		spanId: "sp",
		traceId: "tr",
		parentId: null,
		ownerId: "u1",
		runId: null,
		sessionId: null,
		name: "manifest",
		kind: "manifest",
		startedAt: "2026-05-11T12:00:00.000Z",
		endedAt: null,
		durationMs: null,
		status: "running",
		error: null,
		attributes: {},
		events: [],
		scores: {},
		costUsd: null,
	};
}

function sampleSummary(): TraceSummary {
	return {
		traceId: "tr",
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
	};
}

describe("normalizeTraceLiveEvent", () => {
	it("parses span-start", () => {
		const span = sampleSpan();
		const ev = normalizeTraceLiveEvent({
			event: "span-start",
			data: JSON.stringify({ type: "span-start", span }),
		});
		expect(ev).toEqual({ type: "span-start", span });
	});

	it("parses span-end", () => {
		const ev = normalizeTraceLiveEvent({
			event: "span-end",
			data: JSON.stringify({
				type: "span-end",
				spanId: "sp",
				patch: { status: "ok" as const, endedAt: "2026-05-11T12:00:01.000Z" },
			}),
		});
		expect(ev).toEqual({
			type: "span-end",
			spanId: "sp",
			patch: { status: "ok", endedAt: "2026-05-11T12:00:01.000Z" },
		});
	});

	it("parses trace-done", () => {
		const summary = sampleSummary();
		const ev = normalizeTraceLiveEvent({
			event: "trace-done",
			data: JSON.stringify({ type: "trace-done", summary }),
		});
		expect(ev).toEqual({ type: "trace-done", summary });
	});

	it("parses snapshot (terminal stream)", () => {
		const summary = sampleSummary();
		const spans = [sampleSpan()];
		const ev = normalizeTraceLiveEvent({
			event: "snapshot",
			data: JSON.stringify({ summary, spans }),
		}) as TraceLiveEvent;
		expect(ev).toEqual({ type: "snapshot", summary, spans });
	});

	it("returns null for unknown events", () => {
		expect(normalizeTraceLiveEvent({ event: "what", data: "{}" })).toBeNull();
	});
});
