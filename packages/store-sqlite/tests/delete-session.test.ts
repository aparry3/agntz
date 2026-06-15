import type { Run } from "@agntz/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/sqlite-store.js";

// deleteSession must erase EVERYTHING linked to a session — not just the row and
// its messages, but the invocation logs (which hold prompts/outputs), runs,
// spans, and trace summaries — while leaving other sessions untouched.
describe("SqliteStore deleteSession teardown", () => {
	let admin: SqliteStore;
	let store: ReturnType<SqliteStore["forUser"]>;
	const userId = "u_del";

	beforeEach(() => {
		admin = new SqliteStore(":memory:");
		store = admin.forUser(userId);
	});

	afterEach(() => {
		admin.close();
	});

	async function seed(sessionId: string, suffix: string): Promise<void> {
		await store.getOrCreateSession(sessionId);
		await store.append(sessionId, [
			{
				role: "user",
				content: `hi-${suffix}`,
				timestamp: new Date().toISOString(),
			},
		]);
		await store.log({
			id: `log-${suffix}`,
			agentId: "a",
			sessionId,
			input: "in",
			output: "out",
			toolCalls: [],
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			duration: 1,
			model: "m",
			timestamp: new Date().toISOString(),
		});
		await store.putRun({
			id: `run-${suffix}`,
			rootId: `run-${suffix}`,
			agentId: "a",
			sessionId,
			status: "completed",
			input: "in",
			startedAt: 1,
			depth: 0,
		} as Run);
		// Spans/traces are owner-scoped via the object, not forUser.
		await admin.insertSpan({
			spanId: `span-${suffix}`,
			traceId: `trace-${suffix}`,
			parentId: null,
			ownerId: userId,
			runId: `run-${suffix}`,
			sessionId,
			name: "root",
			kind: "run",
			startedAt: new Date().toISOString(),
			endedAt: null,
			durationMs: null,
			status: "running",
			error: null,
			attributes: {},
			events: [],
			scores: {},
			costUsd: null,
		});
		await admin.upsertSummary({
			traceId: `trace-${suffix}`,
			ownerId: userId,
			rootName: "root",
			agentId: null,
			startedAt: new Date().toISOString(),
			endedAt: null,
			durationMs: null,
			spanCount: 1,
			status: "running",
			totalTokens: 0,
			totalCostUsd: null,
		});
	}

	it("erases all session-linked rows and leaves siblings intact", async () => {
		await seed("s_del", "del");
		await seed("s_keep", "keep");

		await store.deleteSession("s_del");

		// Target session fully erased across every table.
		expect(await store.getMessages("s_del")).toEqual([]);
		expect(await store.getLogs({ sessionId: "s_del" })).toEqual([]);
		expect(await store.getRun("run-del")).toBeNull();
		expect(await admin.getTrace("trace-del", userId)).toEqual([]);
		const traces = await admin.listTraces({ ownerId: userId });
		expect(traces.rows.map((t) => t.traceId)).not.toContain("trace-del");

		// Sibling session untouched.
		expect(await store.getMessages("s_keep")).toHaveLength(1);
		expect(await store.getLogs({ sessionId: "s_keep" })).toHaveLength(1);
		expect(await store.getRun("run-keep")).not.toBeNull();
		expect(await admin.getTrace("trace-keep", userId)).toHaveLength(1);
		expect(traces.rows.map((t) => t.traceId)).toContain("trace-keep");
	});

	it("is idempotent — deleting an already-erased session is a no-op", async () => {
		await seed("s_del", "del");
		await store.deleteSession("s_del");
		await expect(store.deleteSession("s_del")).resolves.toBeUndefined();
	});
});
