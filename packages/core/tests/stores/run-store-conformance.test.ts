import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileStore } from "../../src/stores/json-file.js";
import { MemoryStore } from "../../src/stores/memory.js";
import type { Run, RunListFilters, RunStatus } from "../../src/types.js";

function makeRun(
	overrides: Partial<Run> & { id: string; startedAt: number },
): Run {
	return {
		id: overrides.id,
		rootId: overrides.rootId ?? overrides.id,
		parentId: overrides.parentId,
		agentId: overrides.agentId ?? "alpha",
		userId: overrides.userId,
		sessionId: overrides.sessionId,
		spawnToolUseId: overrides.spawnToolUseId,
		status: overrides.status ?? "running",
		input: overrides.input ?? "hi",
		result: overrides.result,
		error: overrides.error,
		startedAt: overrides.startedAt,
		endedAt: overrides.endedAt,
		depth: overrides.depth ?? 0,
	};
}

interface Scoped {
	putRun(run: Run): Promise<void>;
	listRuns(filters: RunListFilters): Promise<{ rows: Run[]; cursor?: string }>;
}

function runRunStoreListConformance(
	suiteName: string,
	factory: () => Promise<{ store: Scoped; cleanup: () => void }>,
): void {
	describe(`${suiteName} — RunStore.listRuns`, () => {
		let store: Scoped;
		let cleanup: () => void;

		beforeEach(async () => {
			const made = await factory();
			store = made.store;
			cleanup = made.cleanup;
		});

		afterEach(() => cleanup());

		it("returns empty result when no runs exist", async () => {
			const result = await store.listRuns({});
			expect(result.rows).toEqual([]);
			expect(result.cursor).toBeUndefined();
		});

		it("orders by startedAt DESC then id DESC", async () => {
			await store.putRun(makeRun({ id: "a", startedAt: 100 }));
			await store.putRun(makeRun({ id: "b", startedAt: 200 }));
			await store.putRun(makeRun({ id: "c", startedAt: 200 }));
			const result = await store.listRuns({});
			expect(result.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
		});

		it("filters rootsOnly by default (excludes runs with parentId)", async () => {
			await store.putRun(makeRun({ id: "root", startedAt: 100 }));
			await store.putRun(
				makeRun({
					id: "child",
					startedAt: 200,
					parentId: "root",
					rootId: "root",
					depth: 1,
				}),
			);
			const result = await store.listRuns({});
			expect(result.rows.map((r) => r.id)).toEqual(["root"]);
		});

		it("rootsOnly=false returns all runs", async () => {
			await store.putRun(makeRun({ id: "root", startedAt: 100 }));
			await store.putRun(
				makeRun({
					id: "child",
					startedAt: 200,
					parentId: "root",
					rootId: "root",
					depth: 1,
				}),
			);
			const result = await store.listRuns({ rootsOnly: false });
			expect(result.rows.map((r) => r.id).sort()).toEqual(["child", "root"]);
		});

		it("filters by agentId", async () => {
			await store.putRun(
				makeRun({ id: "a", startedAt: 100, agentId: "alpha" }),
			);
			await store.putRun(makeRun({ id: "b", startedAt: 200, agentId: "beta" }));
			const result = await store.listRuns({ agentId: "beta" });
			expect(result.rows.map((r) => r.id)).toEqual(["b"]);
		});

		it("filters by status", async () => {
			await store.putRun(
				makeRun({ id: "a", startedAt: 100, status: "completed" }),
			);
			await store.putRun(
				makeRun({ id: "b", startedAt: 200, status: "failed" }),
			);
			const result = await store.listRuns({ status: "failed" as RunStatus });
			expect(result.rows.map((r) => r.id)).toEqual(["b"]);
		});

		it("filters by startedAfter / startedBefore (ISO inputs)", async () => {
			await store.putRun(makeRun({ id: "a", startedAt: 1_700_000_000_000 })); // 2023-11-14
			await store.putRun(makeRun({ id: "b", startedAt: 1_800_000_000_000 })); // 2027-01-15
			const result = await store.listRuns({
				startedAfter: "2025-01-01T00:00:00.000Z",
				startedBefore: "2030-01-01T00:00:00.000Z",
			});
			expect(result.rows.map((r) => r.id)).toEqual(["b"]);
		});

		it("paginates: limit=2 returns 2 rows + a cursor; next page returns the rest", async () => {
			await store.putRun(makeRun({ id: "a", startedAt: 100 }));
			await store.putRun(makeRun({ id: "b", startedAt: 200 }));
			await store.putRun(makeRun({ id: "c", startedAt: 300 }));

			const page1 = await store.listRuns({ limit: 2 });
			expect(page1.rows.map((r) => r.id)).toEqual(["c", "b"]);
			expect(page1.cursor).toBeDefined();

			const page2 = await store.listRuns({ limit: 2, cursor: page1.cursor });
			expect(page2.rows.map((r) => r.id)).toEqual(["a"]);
			expect(page2.cursor).toBeUndefined();
		});

		it("clamps limit upper bound to 200", async () => {
			for (let i = 0; i < 201; i++) {
				await store.putRun(
					makeRun({
						id: `r${i.toString().padStart(3, "0")}`,
						startedAt: 100 + i,
					}),
				);
			}
			const result = await store.listRuns({ limit: 9999 });
			expect(result.rows.length).toBe(200);
		});

		it("ignores malformed cursor (silent restart from page 1)", async () => {
			await store.putRun(makeRun({ id: "a", startedAt: 100 }));
			const result = await store.listRuns({ cursor: "not-base64-json" });
			expect(result.rows.map((r) => r.id)).toEqual(["a"]);
		});
	});
}

runRunStoreListConformance("MemoryStore", async () => {
	const admin = new MemoryStore();
	const store = admin.forUser("u1");
	return { store, cleanup: () => {} };
});

runRunStoreListConformance("JsonFileStore", async () => {
	const dir = mkdtempSync(join(tmpdir(), "agntz-runstore-"));
	const admin = new JsonFileStore(join(dir, "store.json"));
	const store = admin.forUser("u1");
	return {
		store,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
});
