import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { generateId } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
	try {
		const body = (await req.json()) as {
			datasetId?: string;
			name?: string;
			description?: string;
			agentId?: string;
			metadata?: Record<string, unknown>;
		};
		const datasetId = body.datasetId?.trim() || generateId("dataset");
		const store = await getTenantStore(await requireUserContext());
		const row = await store.createDatasetImport({
			id: generateId("datasetimport"),
			datasetId,
			name: body.name?.trim() || datasetId,
			description: body.description,
			agentId: body.agentId,
			metadata: body.metadata,
		});
		return NextResponse.json(row, { status: 201 });
	} catch (error) {
		return batchErrorResponse(error);
	}
}
