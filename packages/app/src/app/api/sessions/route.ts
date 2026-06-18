import { getTenantStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);
		const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
		const sessions = await store.listSessions(agentId);
		return NextResponse.json(sessions);
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
