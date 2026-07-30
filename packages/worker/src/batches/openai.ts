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
import type { BatchProviderAdapter, ProviderBatchState } from "./types.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

export const openAIBatchAdapter: BatchProviderAdapter = {
	provider: "openai",
	limits: { maxRequests: 50_000, maxInputBytes: 200 * 1024 * 1024 },

	async submit({ config, runId, manifest, requests }) {
		const jsonl = requests
			.map((request) =>
				JSON.stringify({
					custom_id: request.item.id,
					method: "POST",
					url: "/v1/responses",
					body: {
						model: manifest.model.name,
						instructions: request.system,
						input: openAIInput(request.user),
						...(manifest.model.maxTokens
							? { max_output_tokens: manifest.model.maxTokens }
							: {}),
						...(manifest.model.temperature !== undefined
							? { temperature: manifest.model.temperature }
							: {}),
						...(manifest.model.topP !== undefined
							? { top_p: manifest.model.topP }
							: {}),
						...(manifest.outputSchema
							? {
									text: {
										format: {
											type: "json_schema",
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
			...openAIBatchAdapter.limits,
		});
		const form = new FormData();
		form.set("purpose", "batch");
		form.set(
			"file",
			new Blob([jsonl], { type: "application/jsonl" }),
			`${runId}.jsonl`,
		);
		const file = await fetchJson<{ id: string }>(
			providerUrl(config, OPENAI_BASE_URL, "/files"),
			{
				method: "POST",
				headers: auth(config),
				body: form,
			},
		);
		const batch = await fetchJson<Record<string, unknown>>(
			providerUrl(config, OPENAI_BASE_URL, "/batches"),
			{
				method: "POST",
				headers: { ...auth(config), "content-type": "application/json" },
				body: JSON.stringify({
					input_file_id: file.id,
					endpoint: "/v1/responses",
					completion_window: "24h",
					metadata: { agntz_run_id: runId },
				}),
			},
		);
		return {
			id: String(batch.id),
			status: String(batch.status ?? "validating"),
			createdAt: isoFromSeconds(batch.created_at),
			expiresAt: isoFromSeconds(batch.expires_at),
		};
	},

	async get(config, providerBatchId) {
		const batch = await fetchJson<Record<string, unknown>>(
			providerUrl(config, OPENAI_BASE_URL, `/batches/${providerBatchId}`),
			{ headers: auth(config) },
		);
		const status = String(batch.status ?? "unknown");
		const counts = batch.request_counts as Record<string, unknown> | undefined;
		const terminal = ["completed", "failed", "expired", "cancelled"].includes(
			status,
		);
		return {
			id: providerBatchId,
			status,
			terminal,
			outcome: terminal
				? (status as "completed" | "failed" | "expired" | "cancelled")
				: undefined,
			counts: counts
				? {
						total: Number(counts.total ?? 0),
						succeeded: Number(counts.completed ?? 0),
						failed: Number(counts.failed ?? 0),
					}
				: undefined,
			startedAt: isoFromSeconds(batch.in_progress_at),
			endedAt:
				isoFromSeconds(batch.completed_at) ??
				isoFromSeconds(batch.failed_at) ??
				isoFromSeconds(batch.cancelled_at) ??
				isoFromSeconds(batch.expired_at),
			expiresAt: isoFromSeconds(batch.expires_at),
			error: providerErrors(batch.errors),
			raw: batch,
		};
	},

	async cancel(config, providerBatchId) {
		await fetchJson(
			providerUrl(
				config,
				OPENAI_BASE_URL,
				`/batches/${providerBatchId}/cancel`,
			),
			{ method: "POST", headers: auth(config) },
		);
	},

	async results(config, state) {
		const batch = state.raw as Record<string, unknown>;
		const fileIds = [batch.output_file_id, batch.error_file_id].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		);
		const lines: unknown[] = [];
		for (const fileId of fileIds) {
			const text = await fetchText(
				providerUrl(config, OPENAI_BASE_URL, `/files/${fileId}/content`),
				{ headers: auth(config) },
			);
			lines.push(...parseJsonLines(text));
		}
		return lines.map((value) => {
			const row = value as Record<string, unknown>;
			const itemId = String(row.custom_id ?? "");
			const response = row.response as Record<string, unknown> | undefined;
			const body = response?.body as Record<string, unknown> | undefined;
			const error = row.error ?? body?.error;
			if (error || !body) {
				return {
					itemId,
					status: "failed" as const,
					error: providerErrors(error) ?? "Provider request failed",
					providerRequestId:
						typeof response?.request_id === "string"
							? response.request_id
							: undefined,
				};
			}
			const outputText =
				typeof body.output_text === "string"
					? body.output_text
					: extractResponseText(body.output);
			return {
				itemId,
				status: "succeeded" as const,
				output: parseStructuredOutput(outputText),
				rawOutput: outputText,
				usage: openAIUsage(body.usage),
				finishReason: extractFinishReason(body.output),
				providerRequestId:
					typeof body.id === "string"
						? body.id
						: typeof response?.request_id === "string"
							? response.request_id
							: undefined,
			};
		});
	},
};

function auth(config: ProviderConfig): Record<string, string> {
	return { Authorization: `Bearer ${config.apiKey}` };
}

function openAIInput(value: string | unknown[]): string | unknown[] {
	if (typeof value === "string") return value;
	return [
		{
			role: "user",
			content: value.map((part) => {
				if (!part || typeof part !== "object") {
					return { type: "input_text", text: String(part) };
				}
				const row = part as Record<string, unknown>;
				if (row.type === "text") {
					return { type: "input_text", text: row.text };
				}
				const image = row.image_url as
					| Record<string, unknown>
					| string
					| undefined;
				const imageUrl =
					typeof image === "string"
						? image
						: typeof image?.url === "string"
							? image.url
							: undefined;
				if (imageUrl) return { type: "input_image", image_url: imageUrl };
				return { type: "input_text", text: JSON.stringify(row) };
			}),
		},
	];
}

function providerErrors(value: unknown): string | undefined {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map(providerErrors).filter(Boolean).join("; ") || undefined;
	}
	if (typeof value === "object") {
		const row = value as Record<string, unknown>;
		if (typeof row.message === "string") return row.message;
		if (Array.isArray(row.data)) return providerErrors(row.data);
	}
	return JSON.stringify(value);
}

function extractResponseText(value: unknown): string {
	if (!Array.isArray(value)) return "";
	const messages = value.filter(
		(entry) =>
			entry &&
			typeof entry === "object" &&
			(entry as Record<string, unknown>).type === "message",
	);
	return messages
		.map((message) => contentText((message as Record<string, unknown>).content))
		.join("");
}

function extractFinishReason(value: unknown): string | undefined {
	if (!Array.isArray(value)) return undefined;
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const status = (entry as Record<string, unknown>).status;
		if (typeof status === "string") return status;
	}
	return undefined;
}

function parseStructuredOutput(text: string): unknown {
	if (!text) return text;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}
