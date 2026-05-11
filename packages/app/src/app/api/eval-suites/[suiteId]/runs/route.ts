import { NextRequest, NextResponse } from "next/server";
import { requireUserContext, AuthRequiredError } from "@/lib/user";
import { workerRunEval } from "@/lib/worker-client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> }
) {
  try {
    const { suiteId } = await params;
    const { store } = await requireUserContext();
    const runs = await store.listEvalSuiteRuns(suiteId);
    return NextResponse.json(runs);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ suiteId: string }> }
) {
  try {
    const { suiteId } = await params;
    const { userId } = await requireUserContext();
    const run = await workerRunEval({ userId, suiteId });
    return NextResponse.json(run);
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AuthRequiredError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}
