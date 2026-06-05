import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const { store } = await requireUserContext();
		const search = req.nextUrl.searchParams;
		const evalId = search.get("evalId");
		const datasetId = search.get("datasetId");
		if (!evalId || !datasetId) {
			return NextResponse.json(
				{ error: "Missing required query params: evalId, datasetId" },
				{ status: 400 },
			);
		}
		const row = await store.getEvalLatestScore({
			evalId,
			datasetId,
			resolvedAgentVersion: search.get("resolvedAgentVersion") ?? undefined,
		});
		return NextResponse.json(row);
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
