import { AuthRequiredError, requireUserContext, workerIdentity } from "@/lib/user";
import { workerCancelEvalRun } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(
	_req: NextRequest,
	{ params }: { params: Promise<{ runId: string }> },
) {
	try {
		const { runId } = await params;
		const ctx = await requireUserContext();
		const run = await workerCancelEvalRun(workerIdentity(ctx), runId);
		return NextResponse.json(run);
	} catch (error) {
		if (error instanceof AuthRequiredError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 500 },
		);
	}
}
