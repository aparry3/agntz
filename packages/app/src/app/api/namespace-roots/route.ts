import { getStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { normalizeNamespaceGrant } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

// Per-tenant namespace roots: the namespaces this tenant is allowed to operate
// within. The hosted worker bounds an API-key tenant's memory/scope operations
// to these roots. Gated by `api_keys:manage` (see lib/authz.ts).

export async function GET() {
	try {
		const { userId } = await requireUserContext();
		const store = await getStore();
		return NextResponse.json({ roots: await store.listNamespaceRoots(userId) });
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { userId } = await requireUserContext();
		const normalized = await parseRoot(req);
		if (normalized instanceof NextResponse) return normalized;
		const store = await getStore();
		await store.addNamespaceRoot(userId, normalized);
		return NextResponse.json(
			{ roots: await store.listNamespaceRoots(userId) },
			{ status: 201 },
		);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(req: NextRequest) {
	try {
		const { userId } = await requireUserContext();
		const normalized = await parseRoot(req);
		if (normalized instanceof NextResponse) return normalized;
		const store = await getStore();
		await store.removeNamespaceRoot(userId, normalized);
		return NextResponse.json({ roots: await store.listNamespaceRoots(userId) });
	} catch (error) {
		return errorResponse(error);
	}
}

/** Parse + validate `{ root }`. Returns a 400 NextResponse on bad input. */
async function parseRoot(req: NextRequest): Promise<string | NextResponse> {
	const body = (await req.json().catch(() => ({}))) as { root?: unknown };
	const raw = typeof body.root === "string" ? body.root.trim() : "";
	if (!raw) {
		return NextResponse.json(
			{ error: "Missing required field: root (string)" },
			{ status: 400 },
		);
	}
	try {
		return normalizeNamespaceGrant(raw);
	} catch {
		return NextResponse.json(
			{ error: `Invalid namespace root: ${raw}` },
			{ status: 400 },
		);
	}
}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
