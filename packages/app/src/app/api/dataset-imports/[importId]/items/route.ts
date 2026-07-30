import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import type { DatasetItem } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(
	req: NextRequest,
	{ params }: { params: Promise<{ importId: string }> },
) {
	try {
		const body = (await req.json()) as { items?: DatasetItem[] };
		if (!Array.isArray(body.items)) {
			return NextResponse.json(
				{ error: "Missing required field: items (array)" },
				{ status: 400 },
			);
		}
		if (body.items.length > 1_000) {
			return NextResponse.json(
				{ error: "Each import chunk may contain at most 1,000 items" },
				{ status: 413 },
			);
		}
		const { importId } = await params;
		const store = await getTenantStore(await requireUserContext());
		return NextResponse.json(
			await store.appendDatasetImportItems(
				decodeURIComponent(importId),
				body.items,
			),
		);
	} catch (error) {
		return batchErrorResponse(error);
	}
}
