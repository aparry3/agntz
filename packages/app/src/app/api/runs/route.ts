import { NextRequest, NextResponse } from "next/server";
import type { RunListFilters, RunStatus } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET(req: NextRequest) {
  try {
    const { store } = await requireUserContext();
    const params = req.nextUrl.searchParams;

    let limit: number | undefined;
    const limitRaw = params.get("limit");
    if (limitRaw !== null) {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json({ error: "Invalid `limit` query param" }, { status: 400 });
      }
      limit = n;
    }

    const rootsOnlyRaw = params.get("rootsOnly");
    const rootsOnly = rootsOnlyRaw === null ? undefined : rootsOnlyRaw !== "false";

    const filters: RunListFilters = {
      rootsOnly,
      agentId: params.get("agentId") ?? undefined,
      status: (params.get("status") as RunStatus) ?? undefined,
      startedAfter: params.get("startedAfter") ?? undefined,
      startedBefore: params.get("startedBefore") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit,
    };

    const result = await store.listRuns(filters);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
