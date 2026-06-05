import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		const search = req.nextUrl.searchParams;
		const rows = await store.listEvalLatestScores({
			agentId: search.get("agentId") ?? undefined,
			evalId: search.get("evalId") ?? undefined,
			datasetId: search.get("datasetId") ?? undefined,
			resolvedAgentVersion: search.get("resolvedAgentVersion") ?? undefined,
			status: (search.get("status") as never) ?? undefined,
		});
		return NextResponse.json(rows);
	} catch (error) {
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
}
