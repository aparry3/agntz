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
				`/batch-runs${req.nextUrl.search}`,
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		return workerResponse(
			await workerBatchFetch(workerIdentity(ctx), "/batch-runs", {
				method: "POST",
				headers: req.headers.get("Idempotency-Key")
					? {
							"Idempotency-Key": req.headers.get("Idempotency-Key") as string,
						}
					: undefined,
				body: JSON.stringify(await req.json()),
			}),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
