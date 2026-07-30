import { batchErrorResponse, workerResponse } from "@/lib/batches";
import { requireUserContext, workerIdentity } from "@/lib/user";
import { workerBatchFetch } from "@/lib/worker-client";
import type { NextRequest } from "next/server";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ runId: string }> },
) {
	try {
		const ctx = await requireUserContext();
		const { runId } = await params;
		return workerResponse(
			await workerBatchFetch(
				workerIdentity(ctx),
				`/batch-runs/${encodeURIComponent(decodeURIComponent(runId))}/items${req.nextUrl.search}`,
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
