import type { BatchRun } from "@agntz/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/memory.js";
import { SqliteStore } from "../src/sqlite.js";

const MANIFEST = `id: summaries
kind: llm
model:
  provider: openai
  name: gpt-5.4-mini
instruction: Summarize accurately.
prompt: "{{input}}"
`;

type TestRoot = MemoryStore | SqliteStore;
const roots: TestRoot[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		if (root instanceof SqliteStore) root.close();
	}
});

for (const [name, makeStore] of [
	["memory", () => new MemoryStore({ strict: true })],
	["sqlite", () => new SqliteStore(":memory:")],
] as const) {
	describe(`${name} batch persistence`, () => {
		it("versions definitions, resolves aliases, activates versions, and isolates tenants", async () => {
			const root = makeStore();
			roots.push(root);
			const store = root.forUser("user_a");

			await store.putBatch({
				id: "summaries",
				name: "Version one",
				manifest: MANIFEST,
				provider: "openai",
				model: "gpt-5.4-mini",
			});
			const first = await store.getBatch("summaries");
			await store.putBatch({
				id: "summaries",
				name: "Version two",
				manifest: MANIFEST.replace("gpt-5.4-mini", "gpt-5.4"),
				provider: "openai",
				model: "gpt-5.4",
			});

			const versions = await store.listBatchVersions("summaries");
			expect(versions).toHaveLength(2);
			expect((await store.getBatch("summaries"))?.name).toBe("Version two");
			expect(first?.version).toBeTruthy();

			await store.setBatchVersionAlias(
				"summaries",
				first?.version as string,
				"baseline",
			);
			expect(
				await store.resolveBatchVersionAlias("summaries", "baseline"),
			).toBe(first?.version);

			await store.activateBatchVersion("summaries", first?.version as string);
			expect((await store.getBatch("summaries"))?.name).toBe("Version one");
			expect(await root.forUser("user_b").getBatch("summaries")).toBeNull();
		});

		it("finalizes staged imports into normalized, versioned dataset items", async () => {
			const root = makeStore();
			roots.push(root);
			const store = root.forUser("user_a");
			await store.createDatasetImport({
				id: "import_1",
				datasetId: "customers",
				name: "Customers",
				metadata: { source: "test" },
			});
			await store.appendDatasetImportItems("import_1", [
				{ id: "customer_1", input: { name: "Ada" } },
			]);
			const staged = await store.appendDatasetImportItems("import_1", [
				{ id: "customer_2", input: { name: "Grace" } },
			]);
			expect(staged.itemCount).toBe(2);

			const dataset = await store.completeDatasetImport("import_1");
			expect(dataset.version).toBeTruthy();
			expect(dataset.itemCount).toBe(2);
			const firstPage = await store.listDatasetItems("customers", {
				version: dataset.version,
				limit: 1,
			});
			expect(firstPage.rows).toEqual([
				{ id: "customer_1", input: { name: "Ada" } },
			]);
			expect(firstPage.cursor).toBeTruthy();
			expect(
				(
					await store.listDatasetItems("customers", {
						version: dataset.version,
						cursor: firstPage.cursor,
						limit: 1,
					})
				).rows[0]?.id,
			).toBe("customer_2");
			expect((await store.getDatasetImport("import_1"))?.status).toBe(
				"completed",
			);

			await store.putDataset({
				id: "customers",
				name: "Customers replacement",
				items: [{ id: "customer_3", input: { name: "Katherine" } }],
			});
			const repeated = await store.completeDatasetImport("import_1");
			expect(repeated.version).toBe(dataset.version);
			expect(repeated.name).toBe("Customers");
			expect(repeated.itemCount).toBe(2);
		});

		it("stores run items, idempotency keys, filters, and durable leases", async () => {
			const root = makeStore();
			roots.push(root);
			const store = root.forUser("user_a");
			await store.putBatch({
				id: "summaries",
				manifest: MANIFEST,
				provider: "openai",
				model: "gpt-5.4-mini",
			});
			const batch = await store.getBatch("summaries");
			const run: BatchRun = {
				id: "batchrun_1",
				batchId: "summaries",
				batchVersion: batch?.version as string,
				provider: "openai",
				model: "gpt-5.4-mini",
				providerBatchId: "provider_1",
				status: "queued",
				counts: {
					total: 2,
					pending: 2,
					succeeded: 0,
					failed: 0,
					expired: 0,
					cancelled: 0,
				},
				snapshot: { batch: batch! },
				idempotencyKey: "once",
				createdAt: "2026-07-29T12:00:00.000Z",
				nextPollAt: "2026-07-29T12:00:00.000Z",
			};
			await store.putBatchRun(run);
			await store.putBatchRunItems(run.id, [
				{
					runId: run.id,
					itemId: "a",
					ordinal: 0,
					input: "A",
					status: "pending",
				},
				{
					runId: run.id,
					itemId: "b",
					ordinal: 1,
					input: "B",
					status: "pending",
				},
			]);

			expect((await store.getBatchRunByIdempotencyKey("once"))?.id).toBe(
				run.id,
			);
			expect(
				(await store.listBatchRuns({ batchId: "summaries" })).rows,
			).toHaveLength(1);
			expect((await store.listBatchRunItems(run.id)).rows).toHaveLength(2);

			const claimed = await root.claimBatchRuns({
				workerId: "worker_1",
				now: "2026-07-29T12:01:00.000Z",
				leaseUntil: "2026-07-29T12:02:00.000Z",
			});
			expect(claimed).toMatchObject([
				{ ownerId: "user_a", run: { id: "batchrun_1" } },
			]);
			expect(
				await root.claimBatchRuns({
					workerId: "worker_2",
					now: "2026-07-29T12:01:30.000Z",
					leaseUntil: "2026-07-29T12:02:30.000Z",
				}),
			).toEqual([]);
		});
	});
}
