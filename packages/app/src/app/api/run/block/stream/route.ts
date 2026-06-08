import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { workerRunBlockStream } from "@/lib/worker-client";
import type { ManifestSelection } from "@agntz/manifest";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
	try {
		const { userId } = await requireUserContext();
		const body = await req.json();
		const { agentId, input, sessionId, selection } = body;

		if (!agentId) {
			return NextResponse.json(
				{ error: "Missing required field: agentId" },
				{ status: 400 },
			);
		}

		const stream = await workerRunBlockStream({
			userId,
			agentId,
			input,
			sessionId,
			selection: selection as ManifestSelection | undefined,
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
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
