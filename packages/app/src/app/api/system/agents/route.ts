import { NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { ForbiddenError, requireSuperAdmin } from "@/lib/admin";
import { workerListSystemAgents } from "@/lib/worker-client";

export async function GET() {
  try {
    const { userId } = await requireUserContext();
    requireSuperAdmin(userId);

    const agents = await workerListSystemAgents();
    return NextResponse.json(agents);
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
