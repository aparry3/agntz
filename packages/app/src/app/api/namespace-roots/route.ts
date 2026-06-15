import { ForbiddenError, requireSuperAdmin } from "@/lib/admin";
import { getStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { normalizeNamespaceGrant } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

// Per-tenant namespace roots: the namespaces a tenant may operate within. The
// hosted worker bounds an API-key tenant's memory/scope operations to these
// roots, so they are an OPERATOR-ASSIGNED allocation, not self-service — a tenant
// choosing its own roots would defeat tenant isolation. Hence: SUPER-ADMIN only,
// and every call targets an explicit `tenantId`.

export async function GET(req: NextRequest) {
	try {
		const { actorUserId } = await requireUserContext();
		requireSuperAdmin(actorUserId);
		const tenantId = req.nextUrl.searchParams.get("tenantId")?.trim();
		if (!tenantId) {
			return NextResponse.json(
				{ error: "Missing required query param: tenantId" },
				{ status: 400 },
			);
		}
		const store = await getStore();
		return NextResponse.json({
			tenantId,
			roots: await store.listNamespaceRoots(tenantId),
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { actorUserId } = await requireUserContext();
		requireSuperAdmin(actorUserId);
		const parsed = await parseBody(req);
		if (parsed instanceof NextResponse) return parsed;
		const store = await getStore();
		await store.addNamespaceRoot(parsed.tenantId, parsed.root);
		return NextResponse.json(
			{
				tenantId: parsed.tenantId,
				roots: await store.listNamespaceRoots(parsed.tenantId),
			},
			{ status: 201 },
		);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(req: NextRequest) {
	try {
		const { actorUserId } = await requireUserContext();
		requireSuperAdmin(actorUserId);
		const parsed = await parseBody(req);
		if (parsed instanceof NextResponse) return parsed;
		const store = await getStore();
		await store.removeNamespaceRoot(parsed.tenantId, parsed.root);
		return NextResponse.json({
			tenantId: parsed.tenantId,
			roots: await store.listNamespaceRoots(parsed.tenantId),
		});
	} catch (error) {
		return errorResponse(error);
	}
}

/** Parse + validate `{ tenantId, root }`. Returns a 400 NextResponse on bad input. */
async function parseBody(
	req: NextRequest,
): Promise<{ tenantId: string; root: string } | NextResponse> {
	const body = (await req.json().catch(() => ({}))) as {
		tenantId?: unknown;
		root?: unknown;
	};
	const tenantId =
		typeof body.tenantId === "string" ? body.tenantId.trim() : "";
	const raw = typeof body.root === "string" ? body.root.trim() : "";
	if (!tenantId) {
		return NextResponse.json(
			{ error: "Missing required field: tenantId (string)" },
			{ status: 400 },
		);
	}
	if (!raw) {
		return NextResponse.json(
			{ error: "Missing required field: root (string)" },
			{ status: 400 },
		);
	}
	try {
		return { tenantId, root: normalizeNamespaceGrant(raw) };
	} catch {
		return NextResponse.json(
			{ error: `Invalid namespace root: ${raw}` },
			{ status: 400 },
		);
	}
}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError || error instanceof ForbiddenError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
