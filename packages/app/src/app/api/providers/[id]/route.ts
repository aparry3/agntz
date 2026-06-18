import { getTenantStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);

		const provider = await store.getProvider(id);
		if (!provider) {
			return NextResponse.json({ id, configured: false });
		}

		return NextResponse.json({
			id: provider.id,
			configured: true,
			apiKeyPreview: maskKey(provider.apiKey),
			baseUrl: provider.baseUrl,
			config: provider.config,
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);

		const body = await req.json();
		const { apiKey, baseUrl, config } = body;

		if (!apiKey || typeof apiKey !== "string") {
			return NextResponse.json(
				{ error: "Missing required field: apiKey" },
				{ status: 400 },
			);
		}

		await store.putProvider({ id, apiKey, baseUrl, config });
		return NextResponse.json({ id, configured: true });
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);

		await store.deleteProvider(id);
		return NextResponse.json({ id, deleted: true });
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

function maskKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}...${key.slice(-4)}`;
}
