import { batchErrorResponse, normalizeBatchDefinition } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET() {
	try {
		const store = await getTenantStore(await requireUserContext());
		return NextResponse.json(await store.listBatches());
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const definition = normalizeBatchDefinition(await req.json());
		if (await store.getBatch(definition.id)) {
			return NextResponse.json(
				{ error: `Batch '${definition.id}' already exists` },
				{ status: 409 },
			);
		}
		await store.putBatch(definition);
		return NextResponse.json(await store.getBatch(definition.id), {
			status: 201,
		});
	} catch (error) {
		return batchErrorResponse(error);
	}
}
