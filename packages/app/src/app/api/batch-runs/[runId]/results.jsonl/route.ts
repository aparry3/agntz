import { batchErrorResponse, workerResponse } from "@/lib/batches";
import { requireUserContext, workerIdentity } from "@/lib/user";
import { workerBatchFetch } from "@/lib/worker-client";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ runId: string }> },
) {
	try {
		const ctx = await requireUserContext();
		const { runId } = await params;
		return workerResponse(
			await workerBatchFetch(
				workerIdentity(ctx),
				`/batch-runs/${encodeURIComponent(decodeURIComponent(runId))}/results.jsonl`,
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
