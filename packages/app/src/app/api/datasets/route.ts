import { normalizeEvalDataset } from "@/lib/evals";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		return NextResponse.json(
			await store.listDatasets({
				agentId: req.nextUrl.searchParams.get("agentId") ?? undefined,
			}),
		);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		const dataset = normalizeEvalDataset(await req.json());
		await store.putDataset(dataset);
		return NextResponse.json(dataset, { status: 201 });
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
