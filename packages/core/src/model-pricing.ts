import type { TokenUsage } from "./types.js";

/**
 * Per-model rates in USD per 1M tokens. Defaults bundled for major providers.
 * Customers can override per-deployment via env (not wired in this slice).
 *
 * Sources: published 2026-08 list prices. Rates change; check provider docs
 * for production accuracy.
 */
export interface ModelRate {
	promptPer1M: number; // USD per 1M input tokens
	completionPer1M: number; // USD per 1M output tokens
}

const DEFAULT_RATES: Record<string, ModelRate> = {
	"openai/gpt-5.6-sol": { promptPer1M: 5.0, completionPer1M: 30.0 },
	"openai/gpt-5.6-terra": { promptPer1M: 2.0, completionPer1M: 12.0 },
	"openai/gpt-5.6-luna": { promptPer1M: 0.2, completionPer1M: 1.2 },
	"anthropic/claude-fable-5": { promptPer1M: 10.0, completionPer1M: 50.0 },
	"anthropic/claude-opus-5": { promptPer1M: 5.0, completionPer1M: 25.0 },
	"anthropic/claude-sonnet-5": { promptPer1M: 3.0, completionPer1M: 15.0 },
	"anthropic/claude-haiku-4-5": { promptPer1M: 1.0, completionPer1M: 5.0 },
	"google/gemini-3.6-flash": { promptPer1M: 1.5, completionPer1M: 7.5 },
	"google/gemini-3.5-flash": { promptPer1M: 1.5, completionPer1M: 9.0 },
	"google/gemini-3.5-flash-lite": {
		promptPer1M: 0.3,
		completionPer1M: 2.5,
	},
	"mistral/mistral-medium-3-5": {
		promptPer1M: 1.5,
		completionPer1M: 7.5,
	},
	"mistral/mistral-small-2603": {
		promptPer1M: 0.15,
		completionPer1M: 0.6,
	},
	"mistral/mistral-large-2512": {
		promptPer1M: 0.5,
		completionPer1M: 1.5,
	},
	"xai/grok-4.5": { promptPer1M: 2.0, completionPer1M: 6.0 },
	"groq/openai/gpt-oss-120b": { promptPer1M: 0.15, completionPer1M: 0.6 },
	"groq/openai/gpt-oss-20b": { promptPer1M: 0.075, completionPer1M: 0.3 },
	"deepseek/deepseek-v4-pro": {
		promptPer1M: 0.435,
		completionPer1M: 0.87,
	},
	"deepseek/deepseek-v4-flash": {
		promptPer1M: 0.14,
		completionPer1M: 0.28,
	},
};

/**
 * Compute cost in USD from token usage and a (provider, name) tuple.
 * Prefers a per-call cost embedded on the usage object (e.g. OpenRouter
 * reports cost in the response). Falls back to the static rate table.
 * Returns null when no rate is known — callers should not block on this.
 */
export function computeCost(
	usage: TokenUsage,
	provider: string,
	modelName: string,
): number | null {
	if (typeof usage.cost === "number" && Number.isFinite(usage.cost))
		return usage.cost;
	const key = `${provider}/${modelName}`;
	const rate = DEFAULT_RATES[key];
	if (!rate) return null;
	return (
		(usage.promptTokens * rate.promptPer1M +
			usage.completionTokens * rate.completionPer1M) /
		1_000_000
	);
}

/** Test seam — exposes the rate table for verification. */
export function _getRatesForTest(): Readonly<Record<string, ModelRate>> {
	return DEFAULT_RATES;
}
