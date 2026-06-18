import { getTenantStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function GET() {
	try {
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);

		const connections = await store.listConnections("mcp");
		const servers = connections.map((c) => ({
			id: c.id,
			displayName: c.displayName,
			description: c.description ?? null,
			url: (c.config as { url?: string }).url ?? null,
		}));

		return NextResponse.json(servers);
	} catch (error) {
		if (error instanceof AuthRequiredError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}
		return NextResponse.json({ error: String(error) }, { status: 500 });
	}
}
