import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ datasetId: string }> },
) {
	try {
		const { datasetId } = await params;
		const store = await getTenantStore(await requireUserContext());
		return NextResponse.json(
			await store.listDatasetItems(decodeURIComponent(datasetId), {
				version: req.nextUrl.searchParams.get("version") ?? undefined,
				cursor: req.nextUrl.searchParams.get("cursor") ?? undefined,
				limit: Number(req.nextUrl.searchParams.get("limit") ?? 100),
			}),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
