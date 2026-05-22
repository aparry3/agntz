/**
 * Per-provider model catalog fetchers. Each fetcher hits the provider's
 * `/models`-style endpoint, normalizes the response, and returns a
 * uniform ProviderModel[].
 *
 * Auth: reuses the user's stored API key (from ProviderStore) — no new
 * credentials. OpenRouter's /models endpoint is public, so its fetcher
 * skips auth entirely.
 */

export interface ProviderModel {
  /** Canonical model id used in ModelConfig.name. */
  id: string;
  /** Optional pretty label for the picker. Falls back to id. */
  displayName?: string;
  contextLength?: number;
  /** USD per 1M tokens, when reported by the provider. */
  pricing?: { prompt?: number; completion?: number };
  /** Free-form tags (e.g. "free", "preview"). */
  tags?: string[];
}

/** Result of a catalog fetch — `source` lets the UI distinguish live from fallback. */
export interface CatalogResult {
  models: ProviderModel[];
  source: "live" | "fallback";
}

type Fetcher = (apiKey: string) => Promise<ProviderModel[]>;

const FETCH_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const fetchOpenRouter: Fetcher = async () => {
  const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`);
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
    }>;
  };
  return (data.data ?? []).map((m) => {
    const promptStr = m.pricing?.prompt;
    const completionStr = m.pricing?.completion;
    // OpenRouter prices are USD per token as strings — convert to USD per 1M tokens.
    const promptPer1M = promptStr ? parseFloat(promptStr) * 1_000_000 : undefined;
    const completionPer1M = completionStr ? parseFloat(completionStr) * 1_000_000 : undefined;
    const tags: string[] = [];
    if (m.id.endsWith(":free")) tags.push("free");
    return {
      id: m.id,
      displayName: m.name,
      contextLength: m.context_length,
      pricing:
        promptPer1M !== undefined || completionPer1M !== undefined
          ? { prompt: promptPer1M, completion: completionPer1M }
          : undefined,
      tags: tags.length > 0 ? tags : undefined,
    };
  });
};

const fetchOpenAICompatible = (url: string): Fetcher => async (apiKey) => {
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return (data.data ?? []).map((m) => ({ id: m.id }));
};

const fetchAnthropic: Fetcher = async (apiKey) => {
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`Anthropic /models ${res.status}`);
  const data = (await res.json()) as {
    data?: Array<{ id: string; display_name?: string }>;
  };
  return (data.data ?? []).map((m) => ({
    id: m.id,
    displayName: m.display_name,
  }));
};

const fetchGoogle: Fetcher = async (apiKey) => {
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  );
  if (!res.ok) throw new Error(`Google /models ${res.status}`);
  const data = (await res.json()) as {
    models?: Array<{
      name: string;
      displayName?: string;
      inputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      displayName: m.displayName,
      contextLength: m.inputTokenLimit,
    }));
};

const FETCHERS: Record<string, { fetch: Fetcher; requiresKey: boolean }> = {
  openrouter: { fetch: fetchOpenRouter, requiresKey: false },
  openai: { fetch: fetchOpenAICompatible("https://api.openai.com/v1/models"), requiresKey: true },
  anthropic: { fetch: fetchAnthropic, requiresKey: true },
  google: { fetch: fetchGoogle, requiresKey: true },
  groq: { fetch: fetchOpenAICompatible("https://api.groq.com/openai/v1/models"), requiresKey: true },
  xai: { fetch: fetchOpenAICompatible("https://api.x.ai/v1/models"), requiresKey: true },
  mistral: { fetch: fetchOpenAICompatible("https://api.mistral.ai/v1/models"), requiresKey: true },
  deepseek: { fetch: fetchOpenAICompatible("https://api.deepseek.com/models"), requiresKey: true },
};

const CACHE_TTL_MS = 10 * 60 * 1000;
type CacheEntry = { models: ProviderModel[]; expiresAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * Fetch the live model catalog for a provider, using the user's stored API key.
 * Returns null when no fetcher exists for this provider. Throws if the fetcher
 * runs but fails (caller decides whether to fall back).
 */
export async function fetchProviderCatalog(
  providerId: string,
  apiKey: string | undefined,
  cacheKey: string,
): Promise<ProviderModel[] | null> {
  const entry = FETCHERS[providerId];
  if (!entry) return null;
  if (entry.requiresKey && !apiKey) return null;

  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const models = await entry.fetch(apiKey ?? "");
  cache.set(cacheKey, { models, expiresAt: Date.now() + CACHE_TTL_MS });
  return models;
}

/** Test seam — clear the in-memory catalog cache. */
export function _clearCatalogCacheForTest(): void {
  cache.clear();
}
