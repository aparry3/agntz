import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { ForbiddenError, requireSuperAdmin } from "@/lib/admin";
import { workerGetSystemAgent } from "@/lib/worker-client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await requireUserContext();
    requireSuperAdmin(userId);

    // Accept both "agent-builder" and "system:agent-builder"; decode URL encoding first.
    const info = await workerGetSystemAgent(decodeURIComponent(id));
    if (!info) {
      return NextResponse.json({ error: `System agent not found: ${id}` }, { status: 404 });
    }

    return NextResponse.json(info);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
