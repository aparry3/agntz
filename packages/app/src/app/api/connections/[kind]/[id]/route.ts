import {
	KNOWN_CONNECTION_KINDS,
	maskConnectionConfig,
	pingConnection,
	validateConnectionInput,
} from "@/lib/connections";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import type { ConnectionKind } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

type RouteParams = { params: Promise<{ kind: string; id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
	try {
		const { kind, id } = await parseParams(await params);
		const { runner } = await requireUserContext();
		if (!runner.connections) {
			return NextResponse.json(
				{ error: "Connection store not available" },
				{ status: 501 },
			);
		}

		const connection = await runner.connections.getConnection(kind, id);
		if (!connection) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		return NextResponse.json({
			id: connection.id,
			kind: connection.kind,
			displayName: connection.displayName,
			description: connection.description,
			config: maskConnectionConfig(connection.kind, connection.config),
			createdAt: connection.createdAt,
			updatedAt: connection.updatedAt,
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
	try {
		const { kind, id } = await parseParams(await params);
		const { runner } = await requireUserContext();
		if (!runner.connections) {
			return NextResponse.json(
				{ error: "Connection store not available" },
				{ status: 501 },
			);
		}

		const existing = await runner.connections.getConnection(kind, id);
		if (!existing) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		const body = await req.json();
		const displayName = body.displayName ?? existing.displayName;
		const description = body.description ?? existing.description ?? "";
		const config = body.config ?? existing.config;

		const validationError = validateConnectionInput({
			kind,
			displayName,
			config,
			requireId: false,
		});
		if (validationError) {
			return NextResponse.json({ error: validationError }, { status: 400 });
		}

		await runner.connections.putConnection({
			id,
			kind,
			displayName,
			description: description || undefined,
			config,
			createdAt: existing.createdAt,
			updatedAt: new Date().toISOString(),
		});

		const warning = await pingConnection(kind, config);
		return NextResponse.json({
			id,
			kind,
			updated: true,
			...(warning ? { warning } : {}),
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
	try {
		const { kind, id } = await parseParams(await params);
		const { runner } = await requireUserContext();
		if (!runner.connections) {
			return NextResponse.json(
				{ error: "Connection store not available" },
				{ status: 501 },
			);
		}

		await runner.connections.deleteConnection(kind, id);
		return NextResponse.json({ id, kind, deleted: true });
	} catch (error) {
		return errorResponse(error);
	}
}

async function parseParams(p: { kind: string; id: string }): Promise<{
	kind: ConnectionKind;
	id: string;
}> {
	if (!KNOWN_CONNECTION_KINDS.includes(p.kind as ConnectionKind)) {
		throw new BadRequestError(`Unknown kind: ${p.kind}`);
	}
	return { kind: p.kind as ConnectionKind, id: p.id };
}

class BadRequestError extends Error {}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	if (error instanceof BadRequestError) {
		return NextResponse.json({ error: error.message }, { status: 400 });
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
