import type {
	DatasetInput,
	DatasetItem,
	ProviderConfig,
	TokenUsage,
} from "@agntz/contracts";
import { createInitialState, renderTemplate } from "@agntz/core/manifest";
import type { BatchManifest } from "@agntz/core/manifest";
import type { PreparedBatchRequest, ProviderBatchResult } from "./types.js";

export function prepareBatchRequests(
	manifest: BatchManifest,
	items: DatasetItem[],
): PreparedBatchRequest[] {
	return items.map((item) => {
		const state = inputState(item.input, manifest);
		let system = renderTemplate(manifest.instruction, state);
		if (manifest.examples?.length) {
			system += "\n\n## Examples\n";
			for (const example of manifest.examples) {
				system += `\nUser: ${example.input}\nAssistant: ${example.output}\n`;
			}
		}
		return {
			item,
			system,
			user: manifest.prompt
				? renderTemplate(manifest.prompt, state)
				: inputToProviderContent(item.input),
		};
	});
}

export function assertProviderLimits(options: {
	requests: PreparedBatchRequest[];
	jsonl?: string;
	maxRequests?: number;
	maxInputBytes?: number;
}): void {
	if (
		options.maxRequests !== undefined &&
		options.requests.length > options.maxRequests
	) {
		throw new Error(
			`Provider accepts at most ${options.maxRequests.toLocaleString()} requests per batch; received ${options.requests.length.toLocaleString()}`,
		);
	}
	if (options.maxInputBytes !== undefined && options.jsonl !== undefined) {
		const bytes = Buffer.byteLength(options.jsonl);
		if (bytes > options.maxInputBytes) {
			throw new Error(
				`Provider batch input is ${bytes.toLocaleString()} bytes, above its ${options.maxInputBytes.toLocaleString()}-byte limit`,
			);
		}
	}
}

export function providerUrl(
	config: ProviderConfig,
	fallbackBase: string,
	path: string,
): string {
	return `${(config.baseUrl ?? fallbackBase).replace(/\/$/, "")}${path}`;
}

export async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
	const response = await fetch(url, init);
	const text = await response.text();
	let body: unknown = null;
	if (text) {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	if (!response.ok) {
		const detail =
			body && typeof body === "object"
				? JSON.stringify(body)
				: String(body || response.statusText);
		throw new Error(`Provider request failed (${response.status}): ${detail}`);
	}
	return body as T;
}

export async function fetchText(
	url: string,
	init: RequestInit,
): Promise<string> {
	const response = await fetch(url, init);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Provider request failed (${response.status}): ${text || response.statusText}`,
		);
	}
	return text;
}

export function parseJsonLines(text: string): unknown[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown);
}

export function openAIUsage(value: unknown): TokenUsage | undefined {
	if (!value || typeof value !== "object") return undefined;
	const usage = value as Record<string, unknown>;
	const prompt = numberValue(usage.input_tokens ?? usage.prompt_tokens);
	const completion = numberValue(
		usage.output_tokens ?? usage.completion_tokens,
	);
	if (prompt === undefined && completion === undefined) return undefined;
	return {
		promptTokens: prompt ?? 0,
		completionTokens: completion ?? 0,
		totalTokens:
			numberValue(usage.total_tokens) ?? (prompt ?? 0) + (completion ?? 0),
	};
}

export function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return JSON.stringify(value);
	const parts: string[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue;
		const part = entry as Record<string, unknown>;
		if (typeof part.text === "string") parts.push(part.text);
		else if (part.type === "output_text" && typeof part.text === "string") {
			parts.push(part.text);
		}
	}
	return parts.join("");
}

export function errorResult(
	itemId: string,
	error: unknown,
): ProviderBatchResult {
	return {
		itemId,
		status: "failed",
		error:
			error instanceof Error
				? error.message
				: typeof error === "string"
					? error
					: JSON.stringify(error),
	};
}

export function isoFromSeconds(value: unknown): string | undefined {
	const seconds = numberValue(value);
	return seconds === undefined
		? undefined
		: new Date(seconds * 1000).toISOString();
}

export function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: typeof value === "string" &&
				value.trim() &&
				Number.isFinite(Number(value))
			? Number(value)
			: undefined;
}

function inputState(
	input: DatasetInput,
	manifest: BatchManifest,
): Record<string, unknown> {
	const state = createInitialState(input, manifest.inputSchema);
	return {
		...state,
		input,
		userQuery:
			state.userQuery ??
			(typeof input === "string" || Array.isArray(input)
				? input
				: JSON.stringify(input)),
	};
}

function inputToProviderContent(input: DatasetInput): string | unknown[] {
	if (typeof input === "string") return input;
	if (Array.isArray(input)) {
		return input.map((part) => {
			if (part.type === "text") return { type: "text", text: part.text };
			if (part.type === "image") {
				if ("url" in part) {
					return {
						type: "image_url",
						image_url: { url: part.url },
					};
				}
				if ("base64" in part) {
					return {
						type: "image_url",
						image_url: {
							url: `data:${part.mediaType};base64,${part.base64}`,
						},
					};
				}
				throw new Error(
					"Batch dataset image blocks must use url or base64; artifactId is a runtime-only reference",
				);
			}
			return part;
		});
	}
	return JSON.stringify(input);
}
