import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

type Params = { params: Promise<{ importId: string }> };

export async function GET(_req: Request, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const { importId } = await params;
		const row = await store.getDatasetImport(decodeURIComponent(importId));
		if (!row) {
			return NextResponse.json(
				{ error: "Dataset import not found" },
				{ status: 404 },
			);
		}
		return NextResponse.json(row);
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const { importId } = await params;
		await store.deleteDatasetImport(decodeURIComponent(importId));
		return new NextResponse(null, { status: 204 });
	} catch (error) {
		return batchErrorResponse(error);
	}
}
