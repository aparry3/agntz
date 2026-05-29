import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { runner } = await requireUserContext();
		const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;
		const sessions = await runner.sessions.listSessions(agentId);
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
