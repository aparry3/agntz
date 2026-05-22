import type { TokenUsage } from "./types.js";

/**
 * Per-model rates in USD per 1M tokens. Defaults bundled for major providers.
 * Customers can override per-deployment via env (not wired in this slice).
 *
 * Sources: published 2026-05 list prices. Rates change; check provider docs
 * for production accuracy.
 */
export interface ModelRate {
  promptPer1M: number;     // USD per 1M input tokens
  completionPer1M: number; // USD per 1M output tokens
}

const DEFAULT_RATES: Record<string, ModelRate> = {
  "anthropic/claude-opus-4-7":     { promptPer1M: 15.00, completionPer1M: 75.00 },
  "anthropic/claude-sonnet-4-6":   { promptPer1M:  3.00, completionPer1M: 15.00 },
  "anthropic/claude-haiku-4-5":    { promptPer1M:  1.00, completionPer1M:  5.00 },
  "openai/gpt-5":                  { promptPer1M:  5.00, completionPer1M: 15.00 },
  "openai/gpt-5-mini":             { promptPer1M:  0.50, completionPer1M:  2.00 },
  "google/gemini-3-pro":           { promptPer1M:  3.00, completionPer1M: 15.00 },
};

/**
 * Compute cost in USD from token usage and a (provider, name) tuple.
 * Prefers a per-call cost embedded on the usage object (e.g. OpenRouter
 * reports cost in the response). Falls back to the static rate table.
 * Returns null when no rate is known — callers should not block on this.
 */
export function computeCost(usage: TokenUsage, provider: string, modelName: string): number | null {
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) return usage.cost;
  const key = `${provider}/${modelName}`;
  const rate = DEFAULT_RATES[key];
  if (!rate) return null;
  return (usage.promptTokens * rate.promptPer1M + usage.completionTokens * rate.completionPer1M) / 1_000_000;
}

/** Test seam — exposes the rate table for verification. */
export function _getRatesForTest(): Readonly<Record<string, ModelRate>> {
  return DEFAULT_RATES;
}
