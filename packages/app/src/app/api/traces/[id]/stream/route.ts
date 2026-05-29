import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { workerTraceStream } from "@/lib/worker-traces";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	req: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	try {
		const { userId } = await requireUserContext();
		const { id: traceId } = await context.params;

		const upstream = await workerTraceStream({
			userId,
			traceId,
			signal: req.signal,
		});

		if (!upstream.ok || !upstream.body) {
			const body = await upstream.text().catch(() => "");
			return NextResponse.json(
				{ error: `Worker returned ${upstream.status}: ${body}` },
				{ status: upstream.status === 404 ? 404 : 502 },
			);
		}

		return new Response(upstream.body, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache, no-transform",
				Connection: "keep-alive",
			},
		});
	} catch (err) {
		if (err instanceof AuthRequiredError) {
			return NextResponse.json({ error: err.message }, { status: err.status });
		}
		return NextResponse.json({ error: String(err) }, { status: 500 });
	}
}
