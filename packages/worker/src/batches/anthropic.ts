import type { ProviderConfig, TokenUsage } from "@agntz/contracts";
import {
	assertProviderLimits,
	contentText,
	fetchJson,
	fetchText,
	isoFromSeconds,
	parseJsonLines,
	providerUrl,
} from "./common.js";
import type { BatchProviderAdapter } from "./types.js";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";

export const anthropicBatchAdapter: BatchProviderAdapter = {
	provider: "anthropic",
	limits: { maxRequests: 100_000, maxInputBytes: 256 * 1024 * 1024 },

	async submit({ config, manifest, requests }) {
		const body = {
			requests: requests.map((request) => ({
				custom_id: request.item.id,
				params: {
					model: manifest.model.name,
					max_tokens: manifest.model.maxTokens ?? 4096,
					system: request.system,
					messages: [{ role: "user", content: anthropicContent(request.user) }],
					...(manifest.model.temperature !== undefined
						? { temperature: manifest.model.temperature }
						: {}),
					...(manifest.model.topP !== undefined
						? { top_p: manifest.model.topP }
						: {}),
					...(manifest.model.topK !== undefined
						? { top_k: manifest.model.topK }
						: {}),
					...(manifest.model.stopSequences
						? { stop_sequences: manifest.model.stopSequences }
						: {}),
					...(manifest.outputSchema
						? {
								output_config: {
									format: {
										type: "json_schema",
										schema: manifest.outputSchema,
									},
								},
							}
						: {}),
				},
			})),
		};
		const encoded = JSON.stringify(body);
		assertProviderLimits({
			requests,
			jsonl: encoded,
			...anthropicBatchAdapter.limits,
		});
		const batch = await fetchJson<Record<string, unknown>>(
			providerUrl(config, ANTHROPIC_BASE_URL, "/messages/batches"),
			{
				method: "POST",
				headers: headers(config),
				body: encoded,
			},
		);
		return {
			id: String(batch.id),
			status: String(batch.processing_status ?? "in_progress"),
			createdAt: stringValue(batch.created_at),
			expiresAt: stringValue(batch.expires_at),
		};
	},

	async get(config, providerBatchId) {
		const batch = await fetchJson<Record<string, unknown>>(
			providerUrl(
				config,
				ANTHROPIC_BASE_URL,
				`/messages/batches/${providerBatchId}`,
			),
			{ headers: headers(config) },
		);
		const status = String(batch.processing_status ?? "unknown");
		const terminal = status === "ended";
		const counts = batch.request_counts as Record<string, unknown> | undefined;
		const cancelled = Boolean(batch.cancel_initiated_at);
		const expired =
			terminal &&
			Number(counts?.expired ?? 0) > 0 &&
			Number(counts?.succeeded ?? 0) === 0;
		return {
			id: providerBatchId,
			status,
			terminal,
			outcome: terminal
				? cancelled
					? "cancelled"
					: expired
						? "expired"
						: "completed"
				: undefined,
			counts: counts
				? {
						total:
							Number(counts.processing ?? 0) +
							Number(counts.succeeded ?? 0) +
							Number(counts.errored ?? 0) +
							Number(counts.canceled ?? 0) +
							Number(counts.expired ?? 0),
						pending: Number(counts.processing ?? 0),
						succeeded: Number(counts.succeeded ?? 0),
						failed: Number(counts.errored ?? 0),
						cancelled: Number(counts.canceled ?? 0),
						expired: Number(counts.expired ?? 0),
					}
				: undefined,
			endedAt: stringValue(batch.ended_at),
			expiresAt: stringValue(batch.expires_at),
			raw: batch,
		};
	},

	async cancel(config, providerBatchId) {
		await fetchJson(
			providerUrl(
				config,
				ANTHROPIC_BASE_URL,
				`/messages/batches/${providerBatchId}/cancel`,
			),
			{ method: "POST", headers: headers(config) },
		);
	},

	async results(config, state) {
		const text = await fetchText(
			providerUrl(
				config,
				ANTHROPIC_BASE_URL,
				`/messages/batches/${state.id}/results`,
			),
			{ headers: headers(config) },
		);
		return parseJsonLines(text).map((value) => {
			const row = value as Record<string, unknown>;
			const itemId = String(row.custom_id ?? "");
			const result = row.result as Record<string, unknown> | undefined;
			const type = String(result?.type ?? "");
			if (type !== "succeeded") {
				return {
					itemId,
					status:
						type === "canceled"
							? ("cancelled" as const)
							: type === "expired"
								? ("expired" as const)
								: ("failed" as const),
					error: errorText(result?.error) ?? `Anthropic result: ${type}`,
				};
			}
			const message = result?.message as Record<string, unknown> | undefined;
			const output = contentText(message?.content);
			return {
				itemId,
				status: "succeeded" as const,
				output: parseStructuredOutput(output),
				rawOutput: output,
				usage: anthropicUsage(message?.usage),
				finishReason: stringValue(message?.stop_reason),
				providerRequestId: stringValue(message?.id),
			};
		});
	},
};

function headers(config: ProviderConfig): Record<string, string> {
	return {
		"x-api-key": config.apiKey,
		"anthropic-version": "2023-06-01",
		"content-type": "application/json",
	};
}

function anthropicContent(value: string | unknown[]): string | unknown[] {
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
		const data = imageUrl?.match(/^data:([^;]+);base64,(.+)$/s);
		if (data) {
			return {
				type: "image",
				source: { type: "base64", media_type: data[1], data: data[2] },
			};
		}
		if (imageUrl) {
			return { type: "image", source: { type: "url", url: imageUrl } };
		}
		return { type: "text", text: JSON.stringify(row) };
	});
}

function anthropicUsage(value: unknown): TokenUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const usage = value as Record<string, unknown>;
	const prompt = Number(usage.input_tokens ?? 0);
	const completion = Number(usage.output_tokens ?? 0);
	return {
		promptTokens: prompt,
		completionTokens: completion,
		totalTokens: prompt + completion,
	};
}

function errorText(value: unknown): string | undefined {
	if (!value) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "object") {
		const row = value as Record<string, unknown>;
		if (typeof row.message === "string") return row.message;
		if (typeof row.error === "object") return errorText(row.error);
	}
	return JSON.stringify(value);
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string"
		? value
		: typeof value === "number"
			? isoFromSeconds(value)
			: undefined;
}

function parseStructuredOutput(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}
