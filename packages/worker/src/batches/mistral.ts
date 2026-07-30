import type { ProviderConfig } from "@agntz/contracts";
import {
	assertProviderLimits,
	contentText,
	fetchJson,
	fetchText,
	isoFromSeconds,
	openAIUsage,
	parseJsonLines,
	providerUrl,
} from "./common.js";
import type { BatchProviderAdapter } from "./types.js";

const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

export const mistralBatchAdapter: BatchProviderAdapter = {
	provider: "mistral",
	limits: { maxRequests: 1_000_000, maxInputBytes: 512 * 1024 * 1024 },

	async submit({ config, runId, manifest, requests }) {
		const jsonl = requests
			.map((request) =>
				JSON.stringify({
					custom_id: request.item.id,
					body: {
						messages: [
							{ role: "system", content: request.system },
							{ role: "user", content: mistralContent(request.user) },
						],
						...(manifest.model.maxTokens
							? { max_tokens: manifest.model.maxTokens }
							: {}),
						...(manifest.model.temperature !== undefined
							? { temperature: manifest.model.temperature }
							: {}),
						...(manifest.model.topP !== undefined
							? { top_p: manifest.model.topP }
							: {}),
						...(manifest.model.stopSequences
							? { stop: manifest.model.stopSequences }
							: {}),
						...(manifest.model.seed !== undefined
							? { random_seed: manifest.model.seed }
							: {}),
						...(manifest.model.presencePenalty !== undefined
							? { presence_penalty: manifest.model.presencePenalty }
							: {}),
						...(manifest.model.frequencyPenalty !== undefined
							? { frequency_penalty: manifest.model.frequencyPenalty }
							: {}),
						...(manifest.outputSchema
							? {
									response_format: {
										type: "json_schema",
										json_schema: {
											name: manifest.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
											schema: manifest.outputSchema,
											strict: true,
										},
									},
								}
							: {}),
					},
				}),
			)
			.join("\n");
		assertProviderLimits({
			requests,
			jsonl,
			...mistralBatchAdapter.limits,
		});
		const form = new FormData();
		form.set("purpose", "batch");
		form.set(
			"file",
			new Blob([jsonl], { type: "application/jsonl" }),
			`${runId}.jsonl`,
		);
		const file = await fetchJson<{ id: string }>(
			providerUrl(config, MISTRAL_BASE_URL, "/files"),
			{ method: "POST", headers: auth(config), body: form },
		);
		const batch = await fetchJson<Record<string, unknown>>(
			providerUrl(config, MISTRAL_BASE_URL, "/batch/jobs"),
			{
				method: "POST",
				headers: { ...auth(config), "content-type": "application/json" },
				body: JSON.stringify({
					input_files: [file.id],
					model: manifest.model.name,
					endpoint: "/v1/chat/completions",
					metadata: { agntz_run_id: runId },
				}),
			},
		);
		return {
			id: String(batch.id),
			status: String(batch.status ?? "QUEUED"),
			createdAt: isoFromSeconds(batch.created_at),
		};
	},

	async get(config, providerBatchId) {
		const batch = await fetchJson<Record<string, unknown>>(
			providerUrl(config, MISTRAL_BASE_URL, `/batch/jobs/${providerBatchId}`),
			{ headers: auth(config) },
		);
		const status = String(batch.status ?? "UNKNOWN").toUpperCase();
		const terminal = [
			"SUCCESS",
			"FAILED",
			"TIMEOUT_EXCEEDED",
			"CANCELLED",
		].includes(status);
		return {
			id: providerBatchId,
			status,
			terminal,
			outcome: terminal
				? status === "SUCCESS"
					? "completed"
					: status === "CANCELLED"
						? "cancelled"
						: status === "TIMEOUT_EXCEEDED"
							? "expired"
							: "failed"
				: undefined,
			counts: {
				total: Number(batch.total_requests ?? 0),
				succeeded: Number(batch.succeeded_requests ?? 0),
				failed: Number(batch.failed_requests ?? 0),
			},
			startedAt: isoFromSeconds(batch.started_at),
			endedAt: isoFromSeconds(batch.completed_at),
			error: errorText(batch.errors ?? batch.error),
			raw: batch,
		};
	},

	async cancel(config, providerBatchId) {
		await fetchJson(
			providerUrl(
				config,
				MISTRAL_BASE_URL,
				`/batch/jobs/${providerBatchId}/cancel`,
			),
			{ method: "POST", headers: auth(config) },
		);
	},

	async results(config, state) {
		const batch = state.raw as Record<string, unknown>;
		const fileIds = [
			batch.output_file ?? batch.output_file_id,
			batch.error_file,
		].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const lines: unknown[] = [];
		for (const fileId of fileIds) {
			const text = await fetchText(
				providerUrl(config, MISTRAL_BASE_URL, `/files/${fileId}/content`),
				{ headers: auth(config) },
			);
			lines.push(...parseJsonLines(text));
		}
		return lines.map((value) => {
			const row = value as Record<string, unknown>;
			const itemId = String(row.custom_id ?? "");
			const error = row.error;
			const response = row.response as Record<string, unknown> | undefined;
			const body = (response?.body ?? response) as
				| Record<string, unknown>
				| undefined;
			if (error || !body) {
				return {
					itemId,
					status: "failed" as const,
					error: errorText(error) ?? "Mistral request failed",
				};
			}
			const choice = (body.choices as unknown[] | undefined)?.[0] as
				| Record<string, unknown>
				| undefined;
			const message = choice?.message as Record<string, unknown> | undefined;
			const output = contentText(message?.content);
			return {
				itemId,
				status: "succeeded" as const,
				output: parseStructuredOutput(output),
				rawOutput: output,
				usage: openAIUsage(body.usage),
				finishReason: stringValue(choice?.finish_reason),
				providerRequestId:
					stringValue(body.id) ?? stringValue(response?.request_id),
			};
		});
	},
};

function auth(config: ProviderConfig): Record<string, string> {
	return { Authorization: `Bearer ${config.apiKey}` };
}

function mistralContent(value: string | unknown[]): string | unknown[] {
	if (typeof value === "string") return value;
	return value.map((part) => {
		if (!part || typeof part !== "object") {
			return { type: "text", text: String(part) };
		}
		const row = part as Record<string, unknown>;
		if (row.type === "text") return { type: "text", text: row.text };
		const image = row.image_url as Record<string, unknown> | string | undefined;
		const imageUrl =
			typeof image === "string"
				? image
				: typeof image?.url === "string"
					? image.url
					: undefined;
		if (imageUrl) return { type: "image_url", image_url: imageUrl };
		return { type: "text", text: JSON.stringify(row) };
	});
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function errorText(value: unknown): string | undefined {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "object") {
		const row = value as Record<string, unknown>;
		if (typeof row.message === "string") return row.message;
	}
	return JSON.stringify(value);
}

function parseStructuredOutput(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}
