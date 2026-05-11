import { NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";

export async function GET() {
  try {
    const { runner } = await requireUserContext();
    if (!runner.connections) {
      return NextResponse.json([]);
    }

    const connections = await runner.connections.listConnections("mcp");
    const servers = connections.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      description: c.description ?? null,
      url: (c.config as { url?: string }).url ?? null,
    }));

    return NextResponse.json(servers);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
