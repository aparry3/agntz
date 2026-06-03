import type {
	HarnessGenerateTextResult,
	HarnessMessage,
	HarnessModelConfig,
	HarnessStreamTextResult,
	HarnessToolCall,
	ProviderModelEntry,
	TestOutput,
	TestRunContext,
} from "../types.js";

export function modelConfig(model: ProviderModelEntry): {
	provider: HarnessModelConfig["provider"];
	name: string;
} {
	return { provider: model.provider, name: model.model };
}

export function assertNonEmptyText(text: unknown): TestOutput {
	if (typeof text !== "string" || text.trim().length === 0) {
		const preview = JSON.stringify(text)?.slice(0, 120) ?? String(text);
		return { ok: false, reason: `expected non-empty text, got: ${preview}` };
	}
	return { ok: true };
}

export function isAbortError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	return (
		err.name === "AbortError" ||
		err.name === "TimeoutError" ||
		/\babort/i.test(err.message)
	);
}

// Shared single-arg tool used across the tool-calling tests. Minimal schema
// keeps token cost down while still exercising the call → result roundtrip.
export const WEATHER_TOOL = {
	name: "get_weather",
	description: "Get the current weather for a city.",
	parameters: {
		type: "object",
		properties: {
			city: { type: "string", description: "The city to get weather for." },
		},
		required: ["city"],
	},
} as const;

export interface ConsumedStream {
	chunks: number;
	text: string;
	toolCalls: HarnessToolCall[];
	usage: HarnessGenerateTextResult["usage"] | undefined;
	finishReason: string | undefined;
	responseMessages: HarnessMessage[] | undefined;
	streamError?: Error;
}

// Drain a stream defensively. Core exposes `toolCalls`/`usage`/`finishReason`
// as eager promises; if `textStream` throws before they're awaited they float
// as unhandled rejections and crash the process. Settling them up front with
// allSettled (which never rejects) prevents that while still surfacing any
// stream error via `streamError`.
export async function consumeStream(
	stream: HarnessStreamTextResult,
): Promise<ConsumedStream> {
	const trailing = Promise.allSettled([
		stream.toolCalls,
		stream.usage,
		stream.finishReason,
		stream.responseMessages ?? Promise.resolve(undefined),
	]);

	let chunks = 0;
	let text = "";
	let streamError: Error | undefined;
	try {
		for await (const chunk of stream.textStream) {
			chunks++;
			text += chunk;
		}
	} catch (err) {
		streamError = err instanceof Error ? err : new Error(String(err));
	}

	const [tc, usage, finish, responseMessages] = await trailing;

	// Some providers (notably on auth failure) surface the error on the trailing
	// metadata promises rather than the chunk iterator — the textStream just
	// completes empty. Promote the first rejection so the runner can classify it
	// (e.g. as SKIPPED for missing credentials) instead of it looking like an
	// empty-but-successful stream.
	if (!streamError) {
		const rejected = [tc, usage, finish].find((r) => r.status === "rejected");
		if (rejected && rejected.status === "rejected") {
			streamError =
				rejected.reason instanceof Error
					? rejected.reason
					: new Error(String(rejected.reason));
		}
	}

	return {
		chunks,
		text,
		toolCalls: tc.status === "fulfilled" ? tc.value : [],
		usage: usage.status === "fulfilled" ? usage.value : undefined,
		finishReason: finish.status === "fulfilled" ? finish.value : undefined,
		responseMessages:
			responseMessages.status === "fulfilled"
				? responseMessages.value
				: undefined,
		streamError,
	};
}

export function requireStreaming(ctx: TestRunContext): TestOutput | undefined {
	if (!ctx.adapter.streamText) {
		return {
			ok: true,
			skip: `${ctx.sdk} adapter does not support streaming yet`,
		};
	}
	return undefined;
}
