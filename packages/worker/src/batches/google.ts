import type { ProviderConfig, TokenUsage } from "@agntz/contracts";
import {
	assertProviderLimits,
	contentText,
	fetchJson,
	providerUrl,
} from "./common.js";
import type { BatchProviderAdapter } from "./types.js";

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const googleBatchAdapter: BatchProviderAdapter = {
	provider: "google",
	limits: { maxInputBytes: 20 * 1024 * 1024 },

	async submit({ config, runId, manifest, requests }) {
		const body = {
			batch: {
				displayName: `agntz-${runId}`,
				inputConfig: {
					requests: {
						requests: requests.map((request) => ({
							request: {
								contents: [
									{
										role: "user",
										parts: googleParts(request.user),
									},
								],
								systemInstruction: {
									parts: [{ text: request.system }],
								},
								generationConfig: {
									...(manifest.model.maxTokens
										? { maxOutputTokens: manifest.model.maxTokens }
										: {}),
									...(manifest.model.temperature !== undefined
										? { temperature: manifest.model.temperature }
										: {}),
									...(manifest.model.topP !== undefined
										? { topP: manifest.model.topP }
										: {}),
									...(manifest.model.topK !== undefined
										? { topK: manifest.model.topK }
										: {}),
									...(manifest.model.stopSequences
										? { stopSequences: manifest.model.stopSequences }
										: {}),
									...(manifest.model.seed !== undefined
										? { seed: manifest.model.seed }
										: {}),
									...(manifest.model.presencePenalty !== undefined
										? { presencePenalty: manifest.model.presencePenalty }
										: {}),
									...(manifest.model.frequencyPenalty !== undefined
										? { frequencyPenalty: manifest.model.frequencyPenalty }
										: {}),
									...(manifest.outputSchema
										? {
												responseMimeType: "application/json",
												responseJsonSchema: manifest.outputSchema,
											}
										: {}),
								},
							},
							metadata: { key: request.item.id },
						})),
					},
				},
			},
		};
		const encoded = JSON.stringify(body);
		assertProviderLimits({
			requests,
			jsonl: encoded,
			...googleBatchAdapter.limits,
		});
		const created = await fetchJson<Record<string, unknown>>(
			withKey(
				providerUrl(
					config,
					GOOGLE_BASE_URL,
					`/models/${encodeURIComponent(manifest.model.name)}:batchGenerateContent`,
				),
				config,
			),
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: encoded,
			},
		);
		return {
			id: String(created.name),
			status: String(
				(created.metadata as Record<string, unknown> | undefined)?.state ??
					"BATCH_STATE_PENDING",
			),
			createdAt: stringValue(
				(created.metadata as Record<string, unknown> | undefined)?.createTime,
			),
		};
	},

	async get(config, providerBatchId) {
		const operation = await fetchJson<Record<string, unknown>>(
			withKey(
				providerUrl(
					config,
					GOOGLE_BASE_URL,
					`/${providerBatchId.replace(/^\//, "")}`,
				),
				config,
			),
			{},
		);
		const metadata = operation.metadata as Record<string, unknown> | undefined;
		const state = String(
			metadata?.state ??
				(operation.done ? "BATCH_STATE_SUCCEEDED" : "BATCH_STATE_RUNNING"),
		);
		const operationError = operation.error as
			| Record<string, unknown>
			| undefined;
		const cancelled =
			state === "BATCH_STATE_CANCELLED" || Number(operationError?.code) === 1;
		const failed =
			!cancelled &&
			(Boolean(operation.error) || state === "BATCH_STATE_FAILED");
		const expired = state === "BATCH_STATE_EXPIRED";
		const terminal = Boolean(operation.done) || failed || cancelled || expired;
		const stats = metadata?.batchStats as Record<string, unknown> | undefined;
		return {
			id: providerBatchId,
			status: state,
			terminal,
			outcome: terminal
				? failed
					? "failed"
					: cancelled
						? "cancelled"
						: expired
							? "expired"
							: "completed"
				: undefined,
			counts: stats
				? {
						total: Number(stats.requestCount ?? 0),
						pending: Number(stats.pendingRequestCount ?? 0),
						succeeded: Number(stats.successfulRequestCount ?? 0),
						failed: Number(stats.failedRequestCount ?? 0),
					}
				: undefined,
			startedAt: stringValue(metadata?.createTime),
			endedAt: stringValue(metadata?.endTime),
			error: errorText(operation.error),
			raw: operation,
		};
	},

	async cancel(config, providerBatchId) {
		await fetchJson(
			withKey(
				providerUrl(
					config,
					GOOGLE_BASE_URL,
					`/${providerBatchId.replace(/^\//, "")}:cancel`,
				),
				config,
			),
			{ method: "POST", body: "{}" },
		);
	},

	async results(_config, state) {
		const operation = state.raw as Record<string, unknown>;
		const response = operation.response as Record<string, unknown> | undefined;
		const output = response?.output as Record<string, unknown> | undefined;
		const inlined =
			((output?.inlinedResponses as Record<string, unknown> | undefined)
				?.inlinedResponses as unknown[]) ??
			((response?.inlinedResponses as Record<string, unknown> | undefined)
				?.inlinedResponses as unknown[]) ??
			[];
		return inlined.map((value, ordinal) => {
			const row = value as Record<string, unknown>;
			const itemId =
				stringValue(
					(row.metadata as Record<string, unknown> | undefined)?.key,
				) ?? `row_${String(ordinal + 1).padStart(6, "0")}`;
			if (row.error) {
				return {
					itemId,
					status: "failed" as const,
					error: errorText(row.error) ?? "Gemini request failed",
				};
			}
			const generated = (row.response ?? row) as Record<string, unknown>;
			const candidates = generated.candidates as unknown[] | undefined;
			const first = candidates?.[0] as Record<string, unknown> | undefined;
			const output = contentText(
				(first?.content as Record<string, unknown> | undefined)?.parts,
			);
			return {
				itemId,
				status: "succeeded" as const,
				output: parseStructuredOutput(output),
				rawOutput: output,
				usage: googleUsage(generated.usageMetadata),
				finishReason: stringValue(first?.finishReason),
			};
		});
	},
};

function withKey(url: string, config: ProviderConfig): string {
	const parsed = new URL(url);
	parsed.searchParams.set("key", config.apiKey);
	return parsed.toString();
}

function googleParts(value: string | unknown[]): unknown[] {
	if (typeof value === "string") return [{ text: value }];
	return value.map((part) => {
		if (!part || typeof part !== "object") return { text: String(part) };
		const row = part as Record<string, unknown>;
		if (row.type === "text") return { text: row.text };
		const imageUrl = row.image_url as Record<string, unknown> | undefined;
		if (typeof imageUrl?.url === "string" && imageUrl.url.startsWith("data:")) {
			const match = imageUrl.url.match(/^data:([^;]+);base64,(.+)$/s);
			if (match) {
				return { inlineData: { mimeType: match[1], data: match[2] } };
			}
		}
		if (typeof imageUrl?.url === "string") {
			return { fileData: { fileUri: imageUrl.url } };
		}
		return { text: JSON.stringify(row) };
	});
}

function googleUsage(value: unknown): TokenUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const usage = value as Record<string, unknown>;
	const prompt = Number(usage.promptTokenCount ?? 0);
	const completion = Number(usage.candidatesTokenCount ?? 0);
	return {
		promptTokens: prompt,
		completionTokens: completion,
		totalTokens: Number(usage.totalTokenCount ?? prompt + completion),
	};
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

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function parseStructuredOutput(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}
