import { NextRequest, NextResponse } from "next/server";
import { requireWorkspaceContext, WorkspaceRequiredError } from "@/lib/workspace";
import { activateVersion, getVersion } from "@/lib/versions";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; timestamp: string }> }
) {
  try {
    const { id, timestamp } = await params;
    const decodedTimestamp = decodeURIComponent(timestamp);
    const { store } = await requireWorkspaceContext();

    const agent = await getVersion(store, id, decodedTimestamp);
    if (!agent) {
      return NextResponse.json(
        { error: `Version not found for agent "${id}" at ${decodedTimestamp}` },
        { status: 404 }
      );
    }

    await activateVersion(store, id, decodedTimestamp);
    return NextResponse.json({ activated: true, agentId: id, timestamp: decodedTimestamp });
  } catch (error) {
    if (error instanceof WorkspaceRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
