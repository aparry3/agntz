import { AuthRequiredError, requireUserContext, workerIdentity } from "@/lib/user";
import { workerRunBlock } from "@/lib/worker-client";
import type { ManifestSelection } from "@agntz/manifest";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		const body = await req.json();
		const { agentId, input, sessionId, selection } = body;

		if (!agentId) {
			return NextResponse.json(
				{ error: "Missing required field: agentId" },
				{ status: 400 },
			);
		}

		const result = await workerRunBlock({
			...workerIdentity(ctx),
			agentId,
			input,
			sessionId,
			selection: selection as ManifestSelection | undefined,
		});
		return NextResponse.json(result);
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
