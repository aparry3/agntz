import { describe, expect, it } from "vitest";
import { AgntzClient } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";
const MANIFEST = `id: summaries
kind: llm
model:
  provider: openai
  name: gpt-5.4-mini
instruction: Summarize.
`;

function runPayload(id = "batchrun_1") {
	return {
		id,
		batchId: "summaries",
		batchVersion: "2026-07-29T12:00:00.000Z",
		datasetId: "customers",
		datasetVersion: "2026-07-29T12:00:01.000Z",
		provider: "openai",
		model: "gpt-5.4-mini",
		status: "queued",
		counts: {
			total: 2,
			pending: 2,
			succeeded: 0,
			failed: 0,
			expired: 0,
			cancelled: 0,
		},
		snapshot: { batch: { id: "summaries" } },
		createdAt: "2026-07-29T12:00:02.000Z",
	};
}

describe("AgntzClient batches", () => {
	it("creates manifests and submits idempotent, version-pinned runs", async () => {
		const mock = mockFetch((url) => {
			if (url.endsWith("/batches")) {
				return jsonResponse(201, {
					id: "summaries",
					manifest: MANIFEST,
					provider: "openai",
					model: "gpt-5.4-mini",
				});
			}
			return jsonResponse(201, runPayload());
		});
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});

		await client.batches.create(MANIFEST);
		const run = await client.batches.run({
			batchId: "summaries",
			batchVersion: "baseline",
			datasetId: "customers",
			datasetVersion: "production",
			idempotencyKey: "run-once",
		});

		expect(run.id).toBe("batchrun_1");
		expect(mock.calls.map((call) => call.url)).toEqual([
			`${BASE}/batches`,
			`${BASE}/batch-runs`,
		]);
		expect(JSON.parse(mock.calls[0]?.init.body as string)).toEqual({
			manifest: MANIFEST,
		});
		expect(JSON.parse(mock.calls[1]?.init.body as string)).toEqual({
			batchId: "summaries",
			batchVersion: "baseline",
			datasetId: "customers",
			datasetVersion: "production",
		});
		expect(
			(mock.calls[1]?.init.headers as Record<string, string>)[
				"Idempotency-Key"
			],
		).toBe("run-once");
	});

	it("lists, filters, exports, and compares batch run results", async () => {
		const mock = mockFetch((url, init) => {
			if (url.includes("/results.jsonl")) {
				expect((init.headers as Record<string, string>).Accept).toBe(
					"application/x-ndjson",
				);
				return new Response('{"itemId":"a","status":"succeeded"}\n');
			}
			if (url.includes("/compare?")) {
				return jsonResponse(200, {
					leftRun: runPayload("left"),
					rightRun: runPayload("right"),
					rows: [],
					datasetVersionsMatch: true,
				});
			}
			return jsonResponse(200, { rows: [runPayload()] });
		});
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});

		await client.batches.listRuns({
			batchId: "summaries",
			model: "gpt-5.4-mini",
			status: "completed",
			limit: 25,
		});
		expect(await client.batches.resultsJsonl("run/one")).toContain(
			'"status":"succeeded"',
		);
		expect(
			(await client.batches.compare("left run", "right run", { limit: 10 }))
				.datasetVersionsMatch,
		).toBe(true);

		expect(mock.calls[0]?.url).toBe(
			`${BASE}/batch-runs?batchId=summaries&model=gpt-5.4-mini&status=completed&limit=25`,
		);
		expect(mock.calls[1]?.url).toBe(
			`${BASE}/batch-runs/run%2Fone/results.jsonl`,
		);
		expect(mock.calls[2]?.url).toContain(
			"/batch-runs/compare?left=left+run&right=right+run&limit=10",
		);
	});

	it("manages encoded version and alias references and deletes terminal runs", async () => {
		const mock = mockFetch((url, init) => {
			if (init.method === "DELETE") return new Response(null, { status: 204 });
			if (url.includes("/aliases/")) {
				return jsonResponse(200, {
					alias: "good / baseline",
					version: "2026-07-29T12:00:00.000Z",
				});
			}
			return jsonResponse(200, {
				id: "summary / batch",
				manifest: MANIFEST,
				provider: "openai",
				model: "gpt-5.4-mini",
			});
		});
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const batchId = "summary / batch";
		const version = "2026-07-29T12:00:00.000Z";
		const alias = "good / baseline";

		await client.batches.getVersion(batchId, version);
		await client.batches.activateVersion(batchId, version);
		expect(await client.batches.setAlias(batchId, alias, version)).toEqual({
			alias,
			version,
		});
		await client.batches.removeAlias(batchId, alias);
		await client.batches.deleteRun("run / one");

		expect(mock.calls.map((call) => [call.init.method, call.url])).toEqual([
			[
				"GET",
				`${BASE}/batches/summary%20%2F%20batch/versions/2026-07-29T12%3A00%3A00.000Z`,
			],
			[
				"POST",
				`${BASE}/batches/summary%20%2F%20batch/versions/2026-07-29T12%3A00%3A00.000Z/activate`,
			],
			[
				"PUT",
				`${BASE}/batches/summary%20%2F%20batch/aliases/good%20%2F%20baseline`,
			],
			[
				"DELETE",
				`${BASE}/batches/summary%20%2F%20batch/aliases/good%20%2F%20baseline`,
			],
			["DELETE", `${BASE}/batch-runs/run%20%2F%20one`],
		]);
		expect(JSON.parse(mock.calls[2]?.init.body as string)).toEqual({ version });
	});
});

describe("AgntzClient dataset import", () => {
	it("parses CSV and sends normalized items through the staged API", async () => {
		const mock = mockFetch((url) => {
			if (url.endsWith("/dataset-imports")) {
				return jsonResponse(201, {
					id: "import_1",
					datasetId: "customers",
					name: "Customers",
					status: "open",
					itemCount: 0,
					createdAt: "2026-07-29T12:00:00.000Z",
					updatedAt: "2026-07-29T12:00:00.000Z",
				});
			}
			if (url.endsWith("/items")) {
				return jsonResponse(200, { itemCount: 2 });
			}
			return jsonResponse(200, {
				id: "customers",
				name: "Customers",
				items: [],
				itemCount: 2,
				version: "2026-07-29T12:00:01.000Z",
			});
		});
		const client = new AgntzClient({
			apiKey: "key",
			baseUrl: BASE,
			fetch: mock.fetch,
		});

		const dataset = await client.datasets.import({
			source:
				'id,input,segment\ncustomer_1,"Ada, Inc",enterprise\ncustomer_2,Grace,smb',
			format: "csv",
			datasetId: "customers",
			name: "Customers",
		});

		expect(dataset.itemCount).toBe(2);
		expect(mock.calls.map((call) => call.url)).toEqual([
			`${BASE}/dataset-imports`,
			`${BASE}/dataset-imports/import_1/items`,
			`${BASE}/dataset-imports/import_1/complete`,
		]);
		expect(JSON.parse(mock.calls[1]?.init.body as string)).toEqual({
			items: [
				{
					id: "customer_1",
					input: "Ada, Inc",
					metadata: { segment: "enterprise" },
				},
				{
					id: "customer_2",
					input: "Grace",
					metadata: { segment: "smb" },
				},
			],
		});
	});
});
