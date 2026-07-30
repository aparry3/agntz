import { batchErrorResponse, workerResponse } from "@/lib/batches";
import { requireUserContext, workerIdentity } from "@/lib/user";
import { workerBatchFetch } from "@/lib/worker-client";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_req: Request, { params }: Params) {
	try {
		const ctx = await requireUserContext();
		const { runId } = await params;
		return workerResponse(
			await workerBatchFetch(
				workerIdentity(ctx),
				`/batch-runs/${encodeURIComponent(decodeURIComponent(runId))}`,
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	try {
		const ctx = await requireUserContext();
		const { runId } = await params;
		return workerResponse(
			await workerBatchFetch(
				workerIdentity(ctx),
				`/batch-runs/${encodeURIComponent(decodeURIComponent(runId))}`,
				{ method: "DELETE" },
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
