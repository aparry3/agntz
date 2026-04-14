import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";

export async function GET(req: NextRequest) {
  try {
    const { runner } = await requireWorkspaceContext();
    const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
    const sessions = await runner.sessions.listSessions(agentId);
    return NextResponse.json(sessions);
  } catch (error) {
    if (error instanceof WorkspaceRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
