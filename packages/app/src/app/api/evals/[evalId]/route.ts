import { assertEvalDatasetScope, normalizeEvalDefinition } from "@/lib/evals";
import { getTenantStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ evalId: string }> },
) {
	try {
		const { evalId } = await params;
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);
		const row = await store.getEval(evalId);
		if (!row) {
			return NextResponse.json({ error: "Eval not found" }, { status: 404 });
		}
		return NextResponse.json(row);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ evalId: string }> },
) {
	try {
		const { evalId } = await params;
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);
		const existing = await store.getEval(evalId);
		if (!existing) {
			return NextResponse.json({ error: "Eval not found" }, { status: 404 });
		}
		const definition = normalizeEvalDefinition(
			{ ...existing, ...(await req.json()), id: evalId },
			evalId,
		);
		await assertEvalDatasetScope(store, definition);
		await store.putEval(definition);
		return NextResponse.json(definition);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ evalId: string }> },
) {
	try {
		const { evalId } = await params;
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);
		await store.deleteEval(evalId);
		return NextResponse.json({ id: evalId, deleted: true });
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
