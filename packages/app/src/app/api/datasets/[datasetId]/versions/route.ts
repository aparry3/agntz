import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ datasetId: string }> },
) {
	try {
		const { store } = await requireUserContext();
		const { datasetId } = await params;
		return NextResponse.json(
			await store.listDatasetVersions(decodeURIComponent(datasetId)),
		);
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
	return NextResponse.json(
		{ error: error instanceof Error ? error.message : String(error) },
		{ status: 500 },
	);
}
