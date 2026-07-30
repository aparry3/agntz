import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function POST(
	_req: Request,
	{ params }: { params: Promise<{ importId: string }> },
) {
	try {
		const { importId } = await params;
		const store = await getTenantStore(await requireUserContext());
		const staged = await store.getDatasetImport(decodeURIComponent(importId));
		if (!staged) {
			return NextResponse.json(
				{ error: "Dataset import not found" },
				{ status: 404 },
			);
		}
		if (staged.itemCount === 0) {
			return NextResponse.json(
				{ error: "Upload at least one item before completing the import" },
				{ status: 400 },
			);
		}
		return NextResponse.json(
			await store.completeDatasetImport(decodeURIComponent(importId)),
			{ status: 201 },
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
