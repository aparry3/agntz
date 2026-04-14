import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  try {
    const { runner } = await requireWorkspaceContext();
    const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

    const logs = await runner.logs.getLogs({ agentId, limit, offset });
    return NextResponse.json(logs);
  } catch (error) {
    if (error instanceof WorkspaceRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
