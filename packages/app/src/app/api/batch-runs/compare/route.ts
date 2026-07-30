import { batchErrorResponse, workerResponse } from "@/lib/batches";
import { requireUserContext, workerIdentity } from "@/lib/user";
import { workerBatchFetch } from "@/lib/worker-client";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		return workerResponse(
			await workerBatchFetch(
				workerIdentity(ctx),
				`/batch-runs/compare${req.nextUrl.search}`,
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
