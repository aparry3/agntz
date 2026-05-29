import {
	KNOWN_CONNECTION_KINDS,
	maskConnectionConfig,
	pingConnection,
	validateConnectionInput,
} from "@/lib/connections";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import type { ConnectionKind } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { runner } = await requireUserContext();
		if (!runner.connections) {
			return NextResponse.json(
				{ error: "Connection store not available" },
				{ status: 501 },
			);
		}

		const kindParam = req.nextUrl.searchParams.get("kind");
		const kind = kindParam as ConnectionKind | null;
		if (kind && !KNOWN_CONNECTION_KINDS.includes(kind)) {
			return NextResponse.json(
				{ error: `Unknown kind: ${kind}` },
				{ status: 400 },
			);
		}

		const all = await runner.connections.listConnections(kind ?? undefined);
		return NextResponse.json(
			all.map((c) => ({
				id: c.id,
				kind: c.kind,
				displayName: c.displayName,
				description: c.description,
				config: maskConnectionConfig(c.kind, c.config),
				createdAt: c.createdAt,
				updatedAt: c.updatedAt,
			})),
		);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { runner } = await requireUserContext();
		if (!runner.connections) {
			return NextResponse.json(
				{ error: "Connection store not available" },
				{ status: 501 },
			);
		}

		const body = await req.json();
		const { kind, id, displayName, description, config } = body ?? {};

		const validationError = validateConnectionInput({
			kind,
			id,
			displayName,
			config,
		});
		if (validationError) {
			return NextResponse.json({ error: validationError }, { status: 400 });
		}

		const existing = await runner.connections.getConnection(kind, id);
		if (existing) {
			return NextResponse.json(
				{ error: `Connection '${id}' already exists for kind '${kind}'` },
				{ status: 409 },
			);
		}

		const now = new Date().toISOString();
		await runner.connections.putConnection({
			id,
			kind,
			displayName,
			description: description || undefined,
			config,
			createdAt: now,
			updatedAt: now,
		});

		const warning = await pingConnection(kind, config);
		return NextResponse.json(
			{ id, kind, created: true, ...(warning ? { warning } : {}) },
			{ status: 201 },
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
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
