import { NextRequest, NextResponse } from "next/server";
import { listToolsOnServer } from "@agntz/core";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { runner } = await requireUserContext();
    if (!runner.connections) {
      return NextResponse.json({ error: "Connection store not available" }, { status: 501 });
    }

    const connection = await runner.connections.getConnection("mcp", id);
    if (!connection) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const cfg = connection.config as { url?: string; headers?: Record<string, string> };
    if (!cfg.url) {
      return NextResponse.json({ error: "Connection missing url" }, { status: 400 });
    }

    try {
      const tools = await listToolsOnServer(
        { url: cfg.url, headers: cfg.headers },
        { timeoutMs: 5_000 },
      );
      return NextResponse.json({ id, tools });
    } catch (err) {
      return NextResponse.json(
        { id, tools: [], error: `Could not list tools: ${(err as Error).message}` },
        { status: 200 },
      );
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
