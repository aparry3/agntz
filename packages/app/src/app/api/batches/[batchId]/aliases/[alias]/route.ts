import { batchErrorResponse } from "@/lib/batches";
import { getTenantStore } from "@/lib/store";
import { requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ batchId: string; alias: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const value = await params;
		const body = (await req.json()) as { version?: string; createdAt?: string };
		const version = body.version ?? body.createdAt;
		if (!version) {
			return NextResponse.json(
				{ error: "Missing required field: version" },
				{ status: 400 },
			);
		}
		await store.setBatchVersionAlias(
			decodeURIComponent(value.batchId),
			version,
			decodeURIComponent(value.alias),
		);
		return NextResponse.json({
			alias: decodeURIComponent(value.alias),
			version,
		});
	} catch (error) {
		return batchErrorResponse(error);
	}
}

export async function DELETE(_req: Request, { params }: Params) {
	try {
		const store = await getTenantStore(await requireUserContext());
		const value = await params;
		await store.removeBatchVersionAlias(
			decodeURIComponent(value.batchId),
			decodeURIComponent(value.alias),
		);
		return NextResponse.json({
			alias: decodeURIComponent(value.alias),
			deleted: true,
		});
	} catch (error) {
		return batchErrorResponse(error);
	}
}
