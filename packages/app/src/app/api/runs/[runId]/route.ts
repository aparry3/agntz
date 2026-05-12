import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { workerRunsFetch } from "@/lib/worker-runs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { userId } = await requireUserContext();
    const { runId } = await context.params;

    const upstream = await workerRunsFetch({
      userId,
      path: `/runs/${encodeURIComponent(runId)}`,
      signal: req.signal,
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
