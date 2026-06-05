import { assertEvalDatasetScope, normalizeEvalDefinition } from "@/lib/evals";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
		return NextResponse.json(await store.listEvals({ agentId }));
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		const definition = normalizeEvalDefinition(await req.json());
		await assertEvalDatasetScope(store, definition);
		await store.putEval(definition);
		return NextResponse.json(definition, { status: 201 });
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
	const status = message.startsWith("Missing required field") ? 400 : 500;
	return NextResponse.json({ error: message }, { status });
}
