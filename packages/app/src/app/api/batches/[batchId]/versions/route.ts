import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ batchId: string }> },
) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const { batchId } = await params;
		return NextResponse.json(
			await store.listBatchVersions(decodeURIComponent(batchId)),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
