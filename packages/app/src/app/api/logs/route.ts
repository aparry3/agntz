import { getTenantStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		const store = await getTenantStore(ctx);
		const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
		const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
		const offset = Number(req.nextUrl.searchParams.get("offset") ?? "0");

		const logs = await store.getLogs({ agentId, limit, offset });
		return NextResponse.json(logs);
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
