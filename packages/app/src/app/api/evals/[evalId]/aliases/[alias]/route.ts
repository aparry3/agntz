import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ evalId: string; alias: string }> },
) {
	try {
		const { store } = await requireUserContext();
		const { evalId, alias } = await params;
		const body = (await req.json()) as { version?: string; createdAt?: string };
		const version = body.version ?? body.createdAt;
		if (!version) {
			return NextResponse.json(
				{ error: "Missing required field: version" },
				{ status: 400 },
			);
		}
		await store.setEvalVersionAlias(
			decodeURIComponent(evalId),
			version,
			decodeURIComponent(alias),
		);
		return NextResponse.json({ alias: decodeURIComponent(alias), version });
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(
	_req: Request,
	{ params }: { params: Promise<{ evalId: string; alias: string }> },
) {
	try {
		const { store } = await requireUserContext();
		const { evalId, alias } = await params;
		await store.removeEvalVersionAlias(
			decodeURIComponent(evalId),
			decodeURIComponent(alias),
		);
		return NextResponse.json({
			alias: decodeURIComponent(alias),
			deleted: true,
		});
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
