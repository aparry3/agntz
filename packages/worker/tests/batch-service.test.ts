import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it } from "vitest";
import { reconcileBatchRuns, submitBatchRun } from "../src/batches/service.js";
import type { BatchProviderAdapter } from "../src/batches/types.js";
import type { BatchProviderRegistry } from "../src/batches/types.js";

const MANIFEST = `id: summaries
kind: llm
model:
  provider: openai
  name: gpt-5.4-mini
instruction: Summarize accurately.
prompt: "Record: {{input}}"
examples:
  - input: "A long record"
    output: "A short summary"
`;

describe("provider-native batch service", () => {
	it("pins definition and dataset versions, submits once, and completes mixed item results", async () => {
		const store = new MemoryStore({ strict: true });
		const scoped = store.forUser("user_1");
		await scoped.putProvider({ id: "openai", apiKey: "test-key" });
		await scoped.putBatch({
			id: "summaries",
			manifest: MANIFEST,
			provider: "openai",
			model: "gpt-5.4-mini",
			defaultDataset: { id: "customers" },
		});
		await scoped.putDataset({
			id: "customers",
			name: "Customers",
			items: [
				{ id: "a", input: { name: "Ada" } },
				{ id: "b", input: { name: "Grace" } },
			],
		});

		let submitted = 0;
		const adapter: BatchProviderAdapter = {
			provider: "openai",
			limits: { maxRequests: 50_000 },
			async submit(options) {
				submitted++;
				expect(options.requests).toHaveLength(2);
				expect(options.requests[0]?.user).toContain("Ada");
				expect(options.requests[0]?.system).toContain("## Examples");
				return { id: "provider_batch_1", status: "validating" };
			},
			async get() {
				return {
					id: "provider_batch_1",
					status: "completed",
					terminal: true,
					outcome: "completed",
					raw: {},
				};
			},
			async cancel() {},
			async results() {
				return [
					{ itemId: "a", status: "succeeded", output: "Ada summary" },
					{ itemId: "b", status: "failed", error: "content rejected" },
				];
			},
		};
		const providers = {
			openai: adapter,
		} as unknown as BatchProviderRegistry;

		const queued = await submitBatchRun({
			store,
			userId: "user_1",
			providers,
			input: { batchId: "summaries", idempotencyKey: "same-run" },
		});
		const duplicate = await submitBatchRun({
			store,
			userId: "user_1",
			providers,
			input: { batchId: "summaries", idempotencyKey: "same-run" },
		});
		expect(duplicate.id).toBe(queued.id);
		expect(submitted).toBe(1);
		expect(queued.batchVersion).toBeTruthy();
		expect(queued.datasetVersion).toBeTruthy();

		await scoped.putBatchRun({
			...queued,
			nextPollAt: "2020-01-01T00:00:00.000Z",
		});
		const reconciliation = await reconcileBatchRuns({
			store,
			providers,
			workerId: "worker_1",
		});
		expect(reconciliation).toEqual({ claimed: 1, updated: 1, failed: 0 });

		const completed = await scoped.getBatchRun(queued.id);
		expect(completed?.status).toBe("completed");
		expect(completed?.counts).toMatchObject({
			total: 2,
			pending: 0,
			succeeded: 1,
			failed: 1,
		});
		expect(
			(await scoped.listBatchRunItems(queued.id)).rows.map((item) => [
				item.itemId,
				item.status,
			]),
		).toEqual([
			["a", "succeeded"],
			["b", "failed"],
		]);
	});

	it("rejects duplicate item IDs before provider submission", async () => {
		const store = new MemoryStore();
		const scoped = store.forUser("user_1");
		await scoped.putProvider({ id: "openai", apiKey: "test-key" });
		await scoped.putBatch({
			id: "summaries",
			manifest: MANIFEST,
			provider: "openai",
			model: "gpt-5.4-mini",
		});
		const adapter = {
			provider: "openai",
			limits: {},
			submit: async () => {
				throw new Error("must not submit");
			},
		} as unknown as BatchProviderAdapter;

		await expect(
			submitBatchRun({
				store,
				userId: "user_1",
				providers: {
					openai: adapter,
				} as unknown as BatchProviderRegistry,
				input: {
					batchId: "summaries",
					items: [
						{ id: "same", input: "A" },
						{ id: "same", input: "B" },
					],
				},
			}),
		).rejects.toThrow("Duplicate dataset item id");
	});

	it("submits only once when the same idempotency key races", async () => {
		const store = new MemoryStore();
		const scoped = store.forUser("user_1");
		await scoped.putProvider({ id: "openai", apiKey: "test-key" });
		await scoped.putBatch({
			id: "summaries",
			manifest: MANIFEST,
			provider: "openai",
			model: "gpt-5.4-mini",
		});
		let submitted = 0;
		const adapter = {
			provider: "openai",
			limits: {},
			async submit() {
				submitted++;
				await Promise.resolve();
				return { id: "provider_1", status: "queued" };
			},
		} as unknown as BatchProviderAdapter;
		const request = () =>
			submitBatchRun({
				store,
				userId: "user_1",
				providers: {
					openai: adapter,
				} as unknown as BatchProviderRegistry,
				input: {
					batchId: "summaries",
					idempotencyKey: "same-run",
					items: [{ id: "item_1", input: "One" }],
				},
			});

		const [left, right] = await Promise.all([request(), request()]);
		expect(left.id).toBe(right.id);
		expect(submitted).toBe(1);
	});

	it("validates every item against the manifest input schema before persisting a run", async () => {
		const store = new MemoryStore();
		const scoped = store.forUser("user_1");
		await scoped.putProvider({ id: "openai", apiKey: "test-key" });
		await scoped.putBatch({
			id: "summaries",
			manifest: MANIFEST.replace(
				'prompt: "Record: {{input}}"',
				`prompt: "Record: {{name}}"
inputSchema:
  type: object
  properties:
    name: { type: string }
  required: [name]
  additionalProperties: false`,
			),
			provider: "openai",
			model: "gpt-5.4-mini",
		});
		let submitted = false;
		const adapter = {
			provider: "openai",
			limits: {},
			async submit() {
				submitted = true;
				return { id: "must_not_submit", status: "queued" };
			},
		} as unknown as BatchProviderAdapter;

		await expect(
			submitBatchRun({
				store,
				userId: "user_1",
				providers: {
					openai: adapter,
				} as unknown as BatchProviderRegistry,
				input: {
					batchId: "summaries",
					items: [{ id: "item_1", input: {} }],
				},
			}),
		).rejects.toThrow("Agent input");
		expect(submitted).toBe(false);
		expect((await scoped.listBatchRuns()).rows).toEqual([]);
	});
});
