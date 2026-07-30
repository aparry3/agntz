import type { BatchRun } from "@agntz/contracts";
import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it } from "vitest";
import { reconcileBatchRuns } from "../src/batches/service.js";
import type {
	BatchProviderAdapter,
	BatchProviderRegistry,
	ProviderBatchResult,
} from "../src/batches/types.js";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "batch-route-secret";
const USER_ID = "user_1";

function headers() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
		"X-User-Id": USER_ID,
	} as const;
}

function manifest(model: string) {
	return `id: summaries
kind: llm
model:
  provider: openai
  name: ${model}
instruction: Summarize accurately.
prompt: "Record: {{input}}"
`;
}

class FakeBatchProvider implements BatchProviderAdapter {
	readonly provider = "openai";
	readonly limits = { maxRequests: 50_000 };
	private sequence = 0;
	private readonly outputByBatch = new Map<string, ProviderBatchResult[]>();

	async submit(
		options: Parameters<BatchProviderAdapter["submit"]>[0],
	): Promise<{ id: string; status: string }> {
		const id = `provider_${++this.sequence}`;
		this.outputByBatch.set(
			id,
			options.requests.map((request) => ({
				itemId: request.item.id,
				status: "succeeded",
				output: `${options.manifest.model.name}: ${request.user}`,
			})),
		);
		return { id, status: "queued" };
	}

	async get(
		_config: Parameters<BatchProviderAdapter["get"]>[0],
		providerBatchId: string,
	) {
		return {
			id: providerBatchId,
			status: "completed",
			terminal: true,
			outcome: "completed" as const,
			raw: {},
		};
	}

	async cancel() {}

	async results(
		_config: Parameters<BatchProviderAdapter["results"]>[0],
		state: Parameters<BatchProviderAdapter["results"]>[1],
	) {
		return this.outputByBatch.get(state.id) ?? [];
	}
}

describe("batch HTTP routes", () => {
	it("imports a dataset, runs two manifest versions, compares, exports, and deletes", async () => {
		const store = new MemoryStore({ strict: true });
		await store
			.forUser(USER_ID)
			.putProvider({ id: "openai", apiKey: "test-key" });
		const provider = new FakeBatchProvider();
		const providers = {
			openai: provider,
		} as unknown as BatchProviderRegistry;
		const app = createWorkerAPI({
			store,
			internalSecret: SECRET,
			batchProviders: providers,
		});

		const createdResponse = await app.request("/batches", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ userId: USER_ID, manifest: manifest("model-a") }),
		});
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as {
			id: string;
			version: string;
		};
		expect(created.id).toBe("summaries");

		const importResponse = await app.request("/dataset-imports", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				userId: USER_ID,
				datasetId: "customers",
				name: "Customers",
			}),
		});
		expect(importResponse.status).toBe(201);
		const staged = (await importResponse.json()) as { id: string };
		expect(
			(
				await app.request(`/dataset-imports/${staged.id}/items`, {
					method: "POST",
					headers: headers(),
					body: JSON.stringify({
						userId: USER_ID,
						items: [
							{ id: "customer_1", input: { name: "Ada" } },
							{ id: "customer_2", input: { name: "Grace" } },
						],
					}),
				})
			).status,
		).toBe(200);
		const completedImportResponse = await app.request(
			`/dataset-imports/${staged.id}/complete`,
			{
				method: "POST",
				headers: headers(),
				body: JSON.stringify({ userId: USER_ID }),
			},
		);
		expect(completedImportResponse.status).toBe(201);

		const updatedResponse = await app.request("/batches/summaries", {
			method: "PUT",
			headers: headers(),
			body: JSON.stringify({ userId: USER_ID, manifest: manifest("model-b") }),
		});
		expect(updatedResponse.status).toBe(200);
		const updated = (await updatedResponse.json()) as { version: string };
		expect(updated.version).not.toBe(created.version);

		const aliasResponse = await app.request(
			"/batches/summaries/aliases/baseline",
			{
				method: "PUT",
				headers: headers(),
				body: JSON.stringify({
					userId: USER_ID,
					version: created.version,
				}),
			},
		);
		expect(aliasResponse.status).toBe(200);

		const left = await startRun(app, {
			batchVersion: "baseline",
			idempotencyKey: "left",
		});
		const duplicate = await startRun(app, {
			batchVersion: "baseline",
			idempotencyKey: "left",
		});
		expect(duplicate.id).toBe(left.id);
		const right = await startRun(app, { idempotencyKey: "right" });

		const scoped = store.forUser(USER_ID);
		for (const run of [left, right]) {
			await scoped.putBatchRun({
				...run,
				nextPollAt: "2020-01-01T00:00:00.000Z",
			});
		}
		expect(
			await reconcileBatchRuns({
				store,
				providers,
				workerId: "route-test-worker",
			}),
		).toEqual({ claimed: 2, updated: 2, failed: 0 });

		const compareResponse = await app.request(
			`/batch-runs/compare?left=${left.id}&right=${right.id}`,
			{ headers: headers() },
		);
		expect(compareResponse.status).toBe(200);
		const comparison = (await compareResponse.json()) as {
			rows: Array<{
				left: { output: string };
				right: { output: string };
			}>;
			datasetVersionsMatch: boolean;
		};
		expect(comparison.datasetVersionsMatch).toBe(true);
		expect(comparison.rows[0]?.left.output).toContain("model-a");
		expect(comparison.rows[0]?.right.output).toContain("model-b");

		const exportResponse = await app.request(
			`/batch-runs/${right.id}/results.jsonl`,
			{ headers: headers() },
		);
		expect(exportResponse.status).toBe(200);
		expect(exportResponse.headers.get("content-type")).toContain(
			"application/x-ndjson",
		);
		const exported = (await exportResponse.text())
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as { itemId: string });
		expect(exported.map((item) => item.itemId)).toEqual([
			"customer_1",
			"customer_2",
		]);

		expect(
			(
				await app.request(`/batch-runs/${right.id}`, {
					method: "DELETE",
					headers: headers(),
				})
			).status,
		).toBe(204);
		expect(await scoped.getBatchRun(right.id)).toBeNull();
	});
});

async function startRun(
	app: ReturnType<typeof createWorkerAPI>,
	options: { batchVersion?: string; idempotencyKey: string },
): Promise<BatchRun> {
	const response = await app.request("/batch-runs", {
		method: "POST",
		headers: {
			...headers(),
			"Idempotency-Key": options.idempotencyKey,
		},
		body: JSON.stringify({
			userId: USER_ID,
			batchId: "summaries",
			batchVersion: options.batchVersion,
			datasetId: "customers",
		}),
	});
	expect(response.status).toBe(201);
	return (await response.json()) as BatchRun;
}
