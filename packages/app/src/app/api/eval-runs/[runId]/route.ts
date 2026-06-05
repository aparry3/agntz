import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ runId: string }> },
) {
	try {
		const { runId } = await params;
		const { store } = await requireUserContext();
		const row = await store.getEvalRun(runId);
		if (!row) {
			return NextResponse.json(
				{ error: "Eval run not found" },
				{ status: 404 },
			);
		}
		return NextResponse.json(row);
	} catch (error) {
		if (error instanceof AuthRequiredError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}
		return NextResponse.json({ error: String(error) }, { status: 500 });
	}
}
