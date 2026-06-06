import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function POST(
	_req: Request,
	{ params }: { params: Promise<{ evalId: string; version: string }> },
) {
	try {
		const { store } = await requireUserContext();
		const { evalId, version } = await params;
		const id = decodeURIComponent(evalId);
		const resolvedVersion = await resolveEvalVersionRef(
			store,
			id,
			decodeURIComponent(version),
		);
		if (!resolvedVersion) {
			return NextResponse.json(
				{ error: "Eval version not found" },
				{ status: 404 },
			);
		}
		await store.activateEvalVersion(id, resolvedVersion);
		return NextResponse.json(await store.getEval(id));
	} catch (error) {
		return errorResponse(error);
	}
}

async function resolveEvalVersionRef(
	store: Awaited<ReturnType<typeof requireUserContext>>["store"],
	evalId: string,
	version: string,
): Promise<string | null> {
	if (version === "latest") {
		return (await store.listEvalVersions(evalId))[0]?.createdAt ?? null;
	}
	return (await store.resolveEvalVersionAlias(evalId, version)) ?? version;
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
