import type { Span, TraceStore, TraceSummary } from "@agntz/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryTraceRegistry } from "../trace-registry.js";

class FakeTraceStore
	implements Pick<TraceStore, "insertSpansBatch" | "upsertSummary">
{
	inserted: Span[] = [];
	summaries: TraceSummary[] = [];
	async insertSpansBatch(spans: Span[]): Promise<void> {
		this.inserted.push(...spans);
	}
	async upsertSummary(summary: TraceSummary): Promise<void> {
		this.summaries.push(summary);
	}
}

function makeSpan(over: Partial<Span> = {}): Span {
	return {
		spanId: over.spanId ?? `sp_${Math.random().toString(36).slice(2)}`,
		traceId: over.traceId ?? "tr_x",
		parentId: over.parentId ?? null,
		ownerId: over.ownerId ?? "u1",
		runId: null,
		sessionId: null,
		name: over.name ?? "agent.invoke",
		kind: over.kind ?? "invoke",
		startedAt: over.startedAt ?? new Date().toISOString(),
		endedAt: over.endedAt ?? null,
		durationMs: null,
		status: over.status ?? "running",
		error: null,
		attributes: {},
		events: [],
		scores: {},
		costUsd: null,
	};
}

describe("InMemoryTraceRegistry", () => {
	let store: FakeTraceStore;
	let registry: InMemoryTraceRegistry;

	beforeEach(() => {
		vi.useFakeTimers();
		store = new FakeTraceStore();
		registry = new InMemoryTraceRegistry({
			store: store as unknown as TraceStore,
			flushBatchSize: 3,
			flushIntervalMs: 250,
			maxBufferPerOwner: 10,
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes after flushBatchSize span-ends", async () => {
		for (let i = 0; i < 3; i++) {
			registry.spanStart(makeSpan({ spanId: `sp_${i}` }));
			registry.spanEnd(`sp_${i}`, {
				endedAt: new Date().toISOString(),
				status: "ok",
			});
		}
		await registry.waitForFlush();
		expect(store.inserted).toHaveLength(3);
	});

	it("flushes after flushIntervalMs even if under batch size", async () => {
		registry.spanStart(makeSpan({ spanId: "sp_a" }));
		registry.spanEnd("sp_a", {
			endedAt: new Date().toISOString(),
			status: "ok",
		});
		expect(store.inserted).toHaveLength(0); // under batch threshold
		await vi.advanceTimersByTimeAsync(250);
		expect(store.inserted).toHaveLength(1);
	});

	it("subscribers receive live span-start / span-end / trace-done events", async () => {
		const iterator = registry.subscribe("tr_sub", "u1");
		const events: unknown[] = [];
		const consumeP = (async () => {
			for await (const e of iterator) {
				events.push(e);
				if (e.type === "trace-done") break;
			}
		})();

		const span = makeSpan({ spanId: "sp_sub_1", traceId: "tr_sub" });
		registry.spanStart(span);
		registry.spanEnd("sp_sub_1", {
			endedAt: new Date().toISOString(),
			status: "ok",
		});
		registry.traceDone("tr_sub", "u1", {
			traceId: "tr_sub",
			ownerId: "u1",
			rootName: "agent.invoke",
			agentId: null,
			startedAt: new Date().toISOString(),
			endedAt: new Date().toISOString(),
			durationMs: 0,
			spanCount: 1,
			status: "ok",
			totalTokens: 0,
			totalCostUsd: null,
		});

		await consumeP;
		expect(events).toHaveLength(3);
		expect((events[0] as { type: string }).type).toBe("span-start");
		expect((events[1] as { type: string }).type).toBe("span-end");
		expect((events[2] as { type: string }).type).toBe("trace-done");
	});

	it("owner-scopes subscribers (u1 does not see u2 spans)", async () => {
		const u1Iter = registry.subscribe("tr_shared", "u1");
		const u2Iter = registry.subscribe("tr_shared", "u2");
		const u1Events: unknown[] = [];
		const u2Events: unknown[] = [];
		const consume = async (iter: AsyncIterable<unknown>, sink: unknown[]) => {
			for await (const e of iter) {
				sink.push(e);
				if ((e as { type: string }).type === "trace-done") break;
			}
		};
		const p1 = consume(u1Iter, u1Events);
		const p2 = consume(u2Iter, u2Events);

		registry.spanStart(
			makeSpan({ spanId: "sp_u1", traceId: "tr_shared", ownerId: "u1" }),
		);
		registry.spanStart(
			makeSpan({ spanId: "sp_u2", traceId: "tr_shared", ownerId: "u2" }),
		);
		registry.traceDone("tr_shared", "u1", makeSummary("tr_shared", "u1"));
		registry.traceDone("tr_shared", "u2", makeSummary("tr_shared", "u2"));

		await Promise.all([p1, p2]);
		expect(u1Events).toHaveLength(2); // start + done
		expect(u2Events).toHaveLength(2);
		// u1's span was 'sp_u1', not 'sp_u2'
		expect((u1Events[0] as { span: { spanId: string } }).span.spanId).toBe(
			"sp_u1",
		);
		expect((u2Events[0] as { span: { spanId: string } }).span.spanId).toBe(
			"sp_u2",
		);
	});

	it("backpressure drops tool.execute spans first when buffer exceeds cap", async () => {
		// Fill buffer with 10 invoke spans (at cap)
		for (let i = 0; i < 10; i++) {
			registry.spanStart(makeSpan({ spanId: `sp_inv_${i}`, kind: "invoke" }));
		}
		// Adding a tool span beyond cap should be dropped
		registry.spanStart(makeSpan({ spanId: "sp_tool_over", kind: "tool" }));
		await registry.waitForFlush();
		const insertedIds = new Set(store.inserted.map((s) => s.spanId));
		expect(insertedIds.has("sp_tool_over")).toBe(false);
		// Invoke spans survive
		expect(insertedIds.has("sp_inv_0")).toBe(true);
	});

	it("getInProgress returns active spans for trace", () => {
		registry.spanStart(
			makeSpan({ spanId: "sp_ip_1", traceId: "tr_ip", ownerId: "u1" }),
		);
		registry.spanStart(
			makeSpan({ spanId: "sp_ip_2", traceId: "tr_ip", ownerId: "u1" }),
		);
		const got = registry.getInProgress("tr_ip", "u1");
		expect(got).not.toBeNull();
		if (!got) throw new Error("expected in-progress spans");
		expect(got).toHaveLength(2);
	});

	it("getInProgress returns null for unknown trace", () => {
		expect(registry.getInProgress("tr_nope", "u1")).toBeNull();
	});

	it("register marks a trace in-progress before any spans start (returns empty array)", () => {
		registry.register("tr_reg", "u1");
		const got = registry.getInProgress("tr_reg", "u1");
		expect(got).not.toBeNull();
		if (!got) throw new Error("expected registered in-progress trace");
		expect(got).toHaveLength(0);
	});

	it("register is owner-scoped — other owners still see null", () => {
		registry.register("tr_reg", "u1");
		expect(registry.getInProgress("tr_reg", "u2")).toBeNull();
	});

	it("after register, spanStart populates getInProgress with the span", () => {
		registry.register("tr_reg2", "u1");
		registry.spanStart(
			makeSpan({ spanId: "sp_post_reg", traceId: "tr_reg2", ownerId: "u1" }),
		);
		const got = registry.getInProgress("tr_reg2", "u1");
		expect(got).not.toBeNull();
		if (!got) throw new Error("expected registered span");
		expect(got).toHaveLength(1);
		expect(got?.[0].spanId).toBe("sp_post_reg");
	});

	it("traceDone clears the registration so subsequent getInProgress returns null", () => {
		registry.register("tr_reg3", "u1");
		registry.traceDone("tr_reg3", "u1", makeSummary("tr_reg3", "u1"));
		expect(registry.getInProgress("tr_reg3", "u1")).toBeNull();
	});

	it("subscribers attached after register but before first spanStart still receive subsequent events", async () => {
		registry.register("tr_subreg", "u1");
		const iterator = registry.subscribe("tr_subreg", "u1");
		const events: unknown[] = [];
		const consumeP = (async () => {
			for await (const e of iterator) {
				events.push(e);
				if (e.type === "trace-done") break;
			}
		})();

		registry.spanStart(
			makeSpan({ spanId: "sp_subreg_1", traceId: "tr_subreg", ownerId: "u1" }),
		);
		registry.spanEnd("sp_subreg_1", {
			endedAt: new Date().toISOString(),
			status: "ok",
		});
		registry.traceDone("tr_subreg", "u1", makeSummary("tr_subreg", "u1"));

		await consumeP;
		expect(events.map((e) => (e as { type: string }).type)).toEqual([
			"span-start",
			"span-end",
			"trace-done",
		]);
	});
});

function makeSummary(traceId: string, ownerId: string): TraceSummary {
	return {
		traceId,
		ownerId,
		rootName: "agent.invoke",
		agentId: null,
		startedAt: new Date().toISOString(),
		endedAt: new Date().toISOString(),
		durationMs: 0,
		spanCount: 0,
		status: "ok",
		totalTokens: 0,
		totalCostUsd: null,
	};
}
