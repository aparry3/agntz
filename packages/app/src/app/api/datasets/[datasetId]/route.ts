import { normalizeEvalDataset } from "@/lib/evals";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ datasetId: string }> },
) {
	try {
		const { datasetId } = await params;
		const { store } = await requireUserContext();
		const row = await store.getDataset(datasetId);
		if (!row) {
			return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
		}
		return NextResponse.json(row);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ datasetId: string }> },
) {
	try {
		const { datasetId } = await params;
		const { store } = await requireUserContext();
		const existing = await store.getDataset(datasetId);
		if (!existing) {
			return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
		}
		const dataset = normalizeEvalDataset(
			{ ...existing, ...(await req.json()), id: datasetId },
			datasetId,
		);
		await store.putDataset(dataset);
		return NextResponse.json(dataset);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ datasetId: string }> },
) {
	try {
		const { datasetId } = await params;
		const { store } = await requireUserContext();
		await store.deleteDataset(datasetId);
		return NextResponse.json({ id: datasetId, deleted: true });
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	const message = error instanceof Error ? error.message : String(error);
	return NextResponse.json({ error: message }, { status: 500 });
}
