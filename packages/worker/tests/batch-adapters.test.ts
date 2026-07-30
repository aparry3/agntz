import type { BatchManifest } from "@agntz/core/manifest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicBatchAdapter } from "../src/batches/anthropic.js";
import { googleBatchAdapter } from "../src/batches/google.js";
import { mistralBatchAdapter } from "../src/batches/mistral.js";
import { openAIBatchAdapter } from "../src/batches/openai.js";
import type { PreparedBatchRequest } from "../src/batches/types.js";

const manifest: BatchManifest = {
	id: "vision",
	kind: "llm",
	instruction: "Describe the image.",
	model: { provider: "openai", name: "model", maxTokens: 100 },
	outputSchema: {
		type: "object",
		properties: { summary: { type: "string" } },
		required: ["summary"],
	},
};
const requests: PreparedBatchRequest[] = [
	{
		item: {
			id: "item_1",
			input: [
				{ type: "text", text: "Describe this" },
				{
					type: "image",
					base64: "YWJj",
					mediaType: "image/png",
				},
			],
		},
		system: "Describe the image.",
		user: [
			{ type: "text", text: "Describe this" },
			{
				type: "image_url",
				image_url: { url: "data:image/png;base64,YWJj" },
			},
		],
	},
];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("native batch adapter wire formats", () => {
	it("writes Responses API content items into the OpenAI JSONL upload", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				const url = String(input);
				calls.push({ url, init });
				return jsonResponse(
					url.endsWith("/files")
						? { id: "file_1" }
						: {
								id: "batch_1",
								status: "validating",
								created_at: 1_775_000_000,
							},
				);
			}),
		);

		await openAIBatchAdapter.submit({
			config: { id: "openai", apiKey: "key" },
			runId: "run_1",
			manifest,
			requests,
		});

		const form = calls[0]?.init.body as FormData;
		const file = form.get("file") as File;
		const row = JSON.parse(await file.text());
		expect(row.url).toBe("/v1/responses");
		expect(row.body.input).toEqual([
			{
				role: "user",
				content: [
					{ type: "input_text", text: "Describe this" },
					{
						type: "input_image",
						image_url: "data:image/png;base64,YWJj",
					},
				],
			},
		]);
	});

	it("sends only supported Anthropic batch fields and converts base64 images", async () => {
		let body: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: unknown, init: RequestInit = {}) => {
				body = JSON.parse(String(init.body));
				return jsonResponse({
					id: "msgbatch_1",
					processing_status: "in_progress",
				});
			}),
		);

		await anthropicBatchAdapter.submit({
			config: { id: "anthropic", apiKey: "key" },
			runId: "run_1",
			manifest: {
				...manifest,
				model: { ...manifest.model, provider: "anthropic" },
			},
			requests,
		});

		expect(body).not.toHaveProperty("metadata");
		expect(body).toMatchObject({
			requests: [
				{
					custom_id: "item_1",
					params: {
						messages: [
							{
								role: "user",
								content: [
									{ type: "text", text: "Describe this" },
									{
										type: "image",
										source: {
											type: "base64",
											media_type: "image/png",
											data: "YWJj",
										},
									},
								],
							},
						],
					},
				},
			],
		});
	});

	it("normalizes current Gemini batch states, counts, cancellation, and inline output", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					name: "batches/google_1",
					metadata: {
						state: "BATCH_STATE_RUNNING",
						createTime: "2026-07-29T12:00:00Z",
						batchStats: {
							requestCount: "2",
							pendingRequestCount: "1",
							successfulRequestCount: "1",
							failedRequestCount: "0",
						},
					},
					done: false,
				}),
			),
		);
		const state = await googleBatchAdapter.get(
			{ id: "google", apiKey: "key" },
			"batches/google_1",
		);
		expect(state).toMatchObject({
			status: "BATCH_STATE_RUNNING",
			terminal: false,
			counts: { total: 2, pending: 1, succeeded: 1, failed: 0 },
		});

		const results = await googleBatchAdapter.results(
			{ id: "google", apiKey: "key" },
			{
				id: "batches/google_1",
				status: "BATCH_STATE_SUCCEEDED",
				terminal: true,
				outcome: "completed",
				raw: {
					done: true,
					response: {
						output: {
							inlinedResponses: {
								inlinedResponses: [
									{
										metadata: { key: "item_1" },
										response: {
											candidates: [
												{
													content: { parts: [{ text: '{"summary":"ok"}' }] },
													finishReason: "STOP",
												},
											],
										},
									},
								],
							},
						},
					},
				},
			},
		);
		expect(results).toMatchObject([
			{ itemId: "item_1", status: "succeeded", output: { summary: "ok" } },
		]);
	});

	it("passes supported Gemini generation controls through the inline batch request", async () => {
		let body: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: unknown, init: RequestInit = {}) => {
				body = JSON.parse(String(init.body));
				return jsonResponse({
					name: "batches/google_1",
					metadata: { state: "BATCH_STATE_PENDING" },
				});
			}),
		);

		await googleBatchAdapter.submit({
			config: { id: "google", apiKey: "key" },
			runId: "run_1",
			manifest: {
				...manifest,
				model: {
					...manifest.model,
					provider: "google",
					seed: 42,
					presencePenalty: 0.2,
					frequencyPenalty: 0.3,
				},
			},
			requests,
		});

		expect(body).toMatchObject({
			batch: {
				inputConfig: {
					requests: {
						requests: [
							{
								request: {
									generationConfig: {
										seed: 42,
										presencePenalty: 0.2,
										frequencyPenalty: 0.3,
									},
								},
							},
						],
					},
				},
			},
		});
	});

	it("writes supported Mistral sampling controls into the uploaded JSONL", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
				const url = String(input);
				calls.push({ url, init });
				return jsonResponse(
					url.endsWith("/files")
						? { id: "file_1" }
						: { id: "mistral_1", status: "QUEUED" },
				);
			}),
		);

		await mistralBatchAdapter.submit({
			config: { id: "mistral", apiKey: "key" },
			runId: "run_1",
			manifest: {
				...manifest,
				model: {
					...manifest.model,
					provider: "mistral",
					seed: 42,
					presencePenalty: 0.2,
					frequencyPenalty: 0.3,
				},
			},
			requests,
		});

		const form = calls[0]?.init.body as FormData;
		const file = form.get("file") as File;
		const row = JSON.parse(await file.text());
		expect(row.body).toMatchObject({
			random_seed: 42,
			presence_penalty: 0.2,
			frequency_penalty: 0.3,
		});
	});

	it("normalizes Mistral epoch timestamps and job-level errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					id: "mistral_1",
					status: "FAILED",
					total_requests: 2,
					succeeded_requests: 1,
					failed_requests: 1,
					started_at: 1_775_000_000,
					completed_at: 1_775_000_030,
					errors: [{ message: "provider failure" }],
				}),
			),
		);

		const state = await mistralBatchAdapter.get(
			{ id: "mistral", apiKey: "key" },
			"mistral_1",
		);
		expect(state).toMatchObject({
			status: "FAILED",
			terminal: true,
			outcome: "failed",
			error: '[{"message":"provider failure"}]',
		});
		expect(state.startedAt).toMatch(/Z$/);
		expect(state.endedAt).toMatch(/Z$/);
	});
});

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}
