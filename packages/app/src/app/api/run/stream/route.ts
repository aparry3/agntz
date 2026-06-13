import { AuthRequiredError, requireUserContext, workerIdentity } from "@/lib/user";
import { workerRunStream } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		const body = await req.json();
		const { agentId, input, sessionId } = body;

		if (!agentId) {
			return NextResponse.json(
				{ error: "Missing required field: agentId" },
				{ status: 400 },
			);
		}

		const stream = await workerRunStream({
			...workerIdentity(ctx),
			agentId,
			input,
			sessionId,
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
