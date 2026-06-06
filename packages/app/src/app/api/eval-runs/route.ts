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
			evalVersion?: string;
			datasetId?: string;
			datasetVersion?: string;
			agentVersion?: string;
			criterionIds?: string[];
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
			evalVersion: body.evalVersion,
			datasetId: body.datasetId,
			datasetVersion: body.datasetVersion,
			agentVersion: body.agentVersion,
			criterionIds: body.criterionIds,
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
