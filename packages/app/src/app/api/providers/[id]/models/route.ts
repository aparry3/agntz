import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { fetchProviderCatalog, type ProviderModel } from "@/lib/provider-catalogs";
import { findSupportedProvider } from "@/lib/supported-providers";

/**
 * GET /api/providers/[id]/models
 *
 * Returns the live model catalog for a provider when the user has configured
 * its API key. For OpenRouter (public /models), works without a key.
 *
 * Response shape:
 *   200 → { models: ProviderModel[], source: "live" | "fallback" }
 *   409 → { error: "not_configured" } when an authenticated provider has no key
 *   501 → { error: "no_provider_store" } when the runner lacks a ProviderStore
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { userId, runner } = await requireUserContext();
    if (!runner.providers) {
      return NextResponse.json({ error: "no_provider_store" }, { status: 501 });
    }

    const stored = await runner.providers.getProvider(id);
    const apiKey = stored?.apiKey;

    const supported = findSupportedProvider(id);
    const fallback: ProviderModel[] = (supported?.models ?? []).map((m) => ({ id: m }));

    try {
      const live = await fetchProviderCatalog(id, apiKey, `${id}:${userId}`);
      if (live && live.length > 0) {
        return NextResponse.json({ models: live, source: "live" });
      }
      if (live === null && !apiKey && id !== "openrouter") {
        return NextResponse.json({ error: "not_configured" }, { status: 409 });
      }
      return NextResponse.json({ models: fallback, source: "fallback" });
    } catch (fetchErr) {
      console.warn(`[providers/${id}/models] live fetch failed:`, fetchErr);
      return NextResponse.json({ models: fallback, source: "fallback" });
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
