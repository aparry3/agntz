import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ datasetId: string; version: string }> },
) {
	try {
		const { store } = await requireUserContext();
		const { datasetId, version } = await params;
		const id = decodeURIComponent(datasetId);
		const resolvedVersion = await resolveDatasetVersionRef(
			store,
			id,
			decodeURIComponent(version),
		);
		const row = resolvedVersion
			? await store.getDatasetVersion(id, resolvedVersion)
			: null;
		if (!row) {
			return NextResponse.json(
				{ error: "Dataset version not found" },
				{ status: 404 },
			);
		}
		return NextResponse.json(row);
	} catch (error) {
		return errorResponse(error);
	}
}

async function resolveDatasetVersionRef(
	store: Awaited<ReturnType<typeof requireUserContext>>["store"],
	datasetId: string,
	version: string,
): Promise<string | null> {
	if (version === "latest") {
		return (await store.listDatasetVersions(datasetId))[0]?.createdAt ?? null;
	}
	return (
		(await store.resolveDatasetVersionAlias(datasetId, version)) ?? version
	);
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
