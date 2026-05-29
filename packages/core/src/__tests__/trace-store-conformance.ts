import { beforeEach, describe, expect, it } from "vitest";
import type { TraceStore } from "../types.js";
import {
	makeSpan,
	makeSummary,
	makeThreeSpanTrace,
} from "./fixtures/traces.js";

/**
 * Shared TraceStore conformance suite. Every backend's test file calls this
 * with a factory that produces a fresh store for each test. The factory may
 * be async (e.g., to await migrations on Postgres).
 */
export function runTraceStoreConformance(
	suiteName: string,
	makeStore: () => Promise<TraceStore>,
): void {
	describe(`${suiteName} — TraceStore conformance`, () => {
		let store: TraceStore;

		beforeEach(async () => {
			store = await makeStore();
		});

		it("insertSpan + getTrace round-trips a single span", async () => {
			const span = makeSpan({ traceId: "tr_round_trip", ownerId: "u1" });
			await store.insertSpan(span);
			const got = await store.getTrace("tr_round_trip", "u1");
			expect(got).toHaveLength(1);
			expect(got[0].spanId).toBe(span.spanId);
			expect(got[0].traceId).toBe("tr_round_trip");
			expect(got[0].name).toBe("agent.invoke");
		});

		it("insertSpansBatch persists multiple spans atomically", async () => {
			const trace = makeThreeSpanTrace({ traceId: "tr_batch", ownerId: "u1" });
			await store.insertSpansBatch(trace);
			const got = await store.getTrace("tr_batch", "u1");
			expect(got).toHaveLength(3);
			const kinds = got.map((s) => s.kind).sort();
			expect(kinds).toEqual(["invoke", "model", "run"]);
		});

		it("getTrace returns spans owner-scoped", async () => {
			await store.insertSpan(makeSpan({ traceId: "tr_shared", ownerId: "u1" }));
			await store.insertSpan(makeSpan({ traceId: "tr_shared", ownerId: "u2" }));
			const u1 = await store.getTrace("tr_shared", "u1");
			const u2 = await store.getTrace("tr_shared", "u2");
			expect(u1).toHaveLength(1);
			expect(u2).toHaveLength(1);
			expect(u1[0].ownerId).toBe("u1");
			expect(u2[0].ownerId).toBe("u2");
		});

		it("getTrace returns empty array for unknown trace", async () => {
			const got = await store.getTrace("tr_nope", "u1");
			expect(got).toEqual([]);
		});

		it("updateSpan patches endedAt, status, error", async () => {
			const span = makeSpan({
				spanId: "sp_update",
				traceId: "tr_u",
				ownerId: "u1",
			});
			await store.insertSpan(span);
			await store.updateSpan("sp_update", "u1", {
				endedAt: "2026-05-11T08:00:03.000Z",
				durationMs: 3000,
				status: "ok",
			});
			const got = await store.getTrace("tr_u", "u1");
			expect(got[0].endedAt).toBe("2026-05-11T08:00:03.000Z");
			expect(got[0].durationMs).toBe(3000);
			expect(got[0].status).toBe("ok");
		});

		it("updateSpan is owner-scoped (cannot patch another tenant's span)", async () => {
			const span = makeSpan({
				spanId: "sp_owned",
				traceId: "tr_o",
				ownerId: "u1",
			});
			await store.insertSpan(span);
			await store.updateSpan("sp_owned", "u2", { status: "error" });
			const got = await store.getTrace("tr_o", "u1");
			expect(got[0].status).toBe("running");
		});

		it("upsertSummary + getSummary round-trips", async () => {
			const summary = makeSummary({
				traceId: "tr_sum",
				ownerId: "u1",
				agentId: "agent-x",
				spanCount: 3,
				status: "ok",
				durationMs: 1500,
				totalTokens: 412,
			});
			await store.upsertSummary(summary);
			const got = await store.getSummary("tr_sum", "u1");
			expect(got).not.toBeNull();
			expect(got?.agentId).toBe("agent-x");
			expect(got?.spanCount).toBe(3);
			expect(got?.totalTokens).toBe(412);
		});

		it("upsertSummary updates an existing summary", async () => {
			const summary = makeSummary({
				traceId: "tr_up",
				ownerId: "u1",
				status: "running",
				spanCount: 1,
			});
			await store.upsertSummary(summary);
			await store.upsertSummary({
				...summary,
				status: "ok",
				spanCount: 5,
				endedAt: "2026-05-11T08:01:00.000Z",
			});
			const got = await store.getSummary("tr_up", "u1");
			expect(got?.status).toBe("ok");
			expect(got?.spanCount).toBe(5);
			expect(got?.endedAt).toBe("2026-05-11T08:01:00.000Z");
		});

		it("getSummary returns null for unknown trace", async () => {
			const got = await store.getSummary("tr_nope", "u1");
			expect(got).toBeNull();
		});

		it("listTraces returns owner-scoped rows newest-first", async () => {
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_a",
					ownerId: "u1",
					startedAt: "2026-05-11T08:00:00.000Z",
				}),
			);
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_b",
					ownerId: "u1",
					startedAt: "2026-05-11T08:00:30.000Z",
				}),
			);
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_c",
					ownerId: "u2",
					startedAt: "2026-05-11T08:00:15.000Z",
				}),
			);

			const u1 = await store.listTraces({ ownerId: "u1" });
			expect(u1.rows.map((r) => r.traceId)).toEqual(["tr_b", "tr_a"]);

			const u2 = await store.listTraces({ ownerId: "u2" });
			expect(u2.rows.map((r) => r.traceId)).toEqual(["tr_c"]);
		});

		it("listTraces filters by agentId", async () => {
			await store.upsertSummary(
				makeSummary({ traceId: "tr_a", ownerId: "u1", agentId: "alpha" }),
			);
			await store.upsertSummary(
				makeSummary({ traceId: "tr_b", ownerId: "u1", agentId: "beta" }),
			);
			const filtered = await store.listTraces({
				ownerId: "u1",
				agentId: "alpha",
			});
			expect(filtered.rows).toHaveLength(1);
			expect(filtered.rows[0].traceId).toBe("tr_a");
		});

		it("listTraces filters by status", async () => {
			await store.upsertSummary(
				makeSummary({ traceId: "tr_ok", ownerId: "u1", status: "ok" }),
			);
			await store.upsertSummary(
				makeSummary({ traceId: "tr_err", ownerId: "u1", status: "error" }),
			);
			const errors = await store.listTraces({ ownerId: "u1", status: "error" });
			expect(errors.rows).toHaveLength(1);
			expect(errors.rows[0].traceId).toBe("tr_err");
		});

		it("listTraces filters by startedAfter / startedBefore", async () => {
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_old",
					ownerId: "u1",
					startedAt: "2026-05-10T00:00:00.000Z",
				}),
			);
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_new",
					ownerId: "u1",
					startedAt: "2026-05-11T00:00:00.000Z",
				}),
			);
			const recent = await store.listTraces({
				ownerId: "u1",
				startedAfter: "2026-05-10T12:00:00.000Z",
			});
			expect(recent.rows.map((r) => r.traceId)).toEqual(["tr_new"]);
			const old = await store.listTraces({
				ownerId: "u1",
				startedBefore: "2026-05-10T12:00:00.000Z",
			});
			expect(old.rows.map((r) => r.traceId)).toEqual(["tr_old"]);
		});

		it("listTraces paginates via cursor", async () => {
			for (let i = 0; i < 5; i++) {
				await store.upsertSummary(
					makeSummary({
						traceId: `tr_p${i}`,
						ownerId: "u1",
						startedAt: `2026-05-11T08:0${i}:00.000Z`,
					}),
				);
			}
			const page1 = await store.listTraces({ ownerId: "u1", limit: 2 });
			expect(page1.rows).toHaveLength(2);
			// Newest first — last inserted has the largest startedAt.
			expect(page1.rows[0].traceId).toBe("tr_p4");
			expect(page1.rows[1].traceId).toBe("tr_p3");
			expect(page1.cursor).toBeDefined();

			const page2 = await store.listTraces({
				ownerId: "u1",
				limit: 2,
				cursor: page1.cursor,
			});
			expect(page2.rows).toHaveLength(2);
			expect(page2.rows[0].traceId).toBe("tr_p2");
			expect(page2.rows[1].traceId).toBe("tr_p1");
			// Page 3 still has data → cursor on page 2 must be defined.
			expect(page2.cursor).toBeDefined();
			// No overlap between page 1 and page 2.
			const ids1 = new Set(page1.rows.map((r) => r.traceId));
			for (const r of page2.rows) expect(ids1.has(r.traceId)).toBe(false);

			const page3 = await store.listTraces({
				ownerId: "u1",
				limit: 2,
				cursor: page2.cursor,
			});
			expect(page3.rows).toHaveLength(1);
			expect(page3.rows[0].traceId).toBe("tr_p0");
			// Exhausted — no more pages.
			expect(page3.cursor).toBeUndefined();
		});

		it("deleteTrace removes all spans and summary", async () => {
			const trace = makeThreeSpanTrace({ traceId: "tr_del", ownerId: "u1" });
			await store.insertSpansBatch(trace);
			await store.upsertSummary(
				makeSummary({ traceId: "tr_del", ownerId: "u1", spanCount: 3 }),
			);

			await store.deleteTrace("tr_del", "u1");

			expect(await store.getTrace("tr_del", "u1")).toEqual([]);
			expect(await store.getSummary("tr_del", "u1")).toBeNull();
		});

		it("deleteTrace is owner-scoped", async () => {
			await store.insertSpan(makeSpan({ traceId: "tr_keep", ownerId: "u1" }));
			await store.deleteTrace("tr_keep", "u2");
			expect(await store.getTrace("tr_keep", "u1")).toHaveLength(1);
		});

		it("deleteOlderThan deletes traces whose startedAt < cutoff, returns count", async () => {
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_old1",
					ownerId: "u1",
					startedAt: "2026-05-09T00:00:00.000Z",
				}),
			);
			await store.insertSpan(
				makeSpan({
					traceId: "tr_old1",
					ownerId: "u1",
					startedAt: "2026-05-09T00:00:00.000Z",
				}),
			);
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_new1",
					ownerId: "u1",
					startedAt: "2026-05-11T00:00:00.000Z",
				}),
			);
			await store.insertSpan(
				makeSpan({
					traceId: "tr_new1",
					ownerId: "u1",
					startedAt: "2026-05-11T00:00:00.000Z",
				}),
			);

			const cutoff = new Date("2026-05-10T00:00:00.000Z");
			const deleted = await store.deleteOlderThan("u1", cutoff);
			expect(deleted).toBe(1);

			expect(await store.getTrace("tr_old1", "u1")).toEqual([]);
			expect(await store.getTrace("tr_new1", "u1")).toHaveLength(1);
		});

		it("deleteOlderThan is owner-scoped", async () => {
			await store.upsertSummary(
				makeSummary({
					traceId: "tr_u2_old",
					ownerId: "u2",
					startedAt: "2026-05-01T00:00:00.000Z",
				}),
			);
			const deleted = await store.deleteOlderThan(
				"u1",
				new Date("2026-05-10T00:00:00.000Z"),
			);
			expect(deleted).toBe(0);
			expect(await store.getSummary("tr_u2_old", "u2")).not.toBeNull();
		});
	});
}
