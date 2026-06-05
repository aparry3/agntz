import { evalRunFiltersFromSearch } from "@/lib/evals";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { workerEvalRun } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		return NextResponse.json(
			await store.listEvalRuns(
				evalRunFiltersFromSearch(req.nextUrl.searchParams),
			),
		);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { userId } = await requireUserContext();
		const body = (await req.json()) as {
			evalId?: string;
			datasetId?: string;
			agentVersion?: string;
		};
		if (!body.evalId) {
			return NextResponse.json(
				{ error: "Missing required field: evalId" },
				{ status: 400 },
			);
		}
		const run = await workerEvalRun({
			userId,
			evalId: body.evalId,
			datasetId: body.datasetId,
			agentVersion: body.agentVersion,
		});
		return NextResponse.json(run, { status: 201 });
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
