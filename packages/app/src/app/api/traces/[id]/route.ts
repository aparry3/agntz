import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { userId, store } = await requireUserContext();
    const { id: traceId } = await context.params;
    const summary = await store.getSummary(traceId, userId);
    if (!summary) {
      return NextResponse.json({ error: "Trace not found" }, { status: 404 });
    }
    const spans = await store.getTrace(traceId, userId);
    return NextResponse.json({ summary, spans });
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
