import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function POST(
	_req: Request,
	{ params }: { params: Promise<{ batchId: string; version: string }> },
) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const value = await params;
		const batchId = decodeURIComponent(value.batchId);
		const requested = decodeURIComponent(value.version);
		const version =
			requested === "latest"
				? (await store.listBatchVersions(batchId))[0]?.createdAt
				: ((await store.resolveBatchVersionAlias(batchId, requested)) ??
					requested);
		if (!version) {
			return NextResponse.json(
				{ error: "Batch version not found" },
				{ status: 404 },
			);
		}
		await store.activateBatchVersion(batchId, version);
		return NextResponse.json(await store.getBatch(batchId));
	} catch (error) {
		return batchErrorResponse(error);
	}
}
