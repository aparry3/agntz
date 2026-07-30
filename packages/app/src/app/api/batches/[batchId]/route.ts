import { batchErrorResponse, normalizeBatchDefinition } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ batchId: string }> };

export async function GET(_req: Request, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const { batchId } = await params;
		const row = await store.getBatch(decodeURIComponent(batchId));
		if (!row) {
			return NextResponse.json({ error: "Batch not found" }, { status: 404 });
		}
		return NextResponse.json(row);
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function PUT(req: NextRequest, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const { batchId } = await params;
		const id = decodeURIComponent(batchId);
		if (!(await store.getBatch(id))) {
			return NextResponse.json({ error: "Batch not found" }, { status: 404 });
		}
		const definition = normalizeBatchDefinition(await req.json(), id);
		await store.putBatch(definition);
		return NextResponse.json(await store.getBatch(id));
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const { batchId } = await params;
		await store.deleteBatch(decodeURIComponent(batchId));
		return new NextResponse(null, { status: 204 });
	} catch (error) {
		return batchErrorResponse(error);
	}
}
