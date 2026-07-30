import { batchErrorResponse, workerResponse } from "@/lib/batches";
import { requireUserContext, workerIdentity } from "@/lib/user";
import { workerBatchFetch } from "@/lib/worker-client";

export async function POST(
	_req: Request,
	{ params }: { params: Promise<{ runId: string }> },
) {
	try {
		const ctx = await requireUserContext();
		const { runId } = await params;
		return workerResponse(
			await workerBatchFetch(
				workerIdentity(ctx),
				`/batch-runs/${encodeURIComponent(decodeURIComponent(runId))}/cancel`,
				{ method: "POST", body: "{}" },
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
