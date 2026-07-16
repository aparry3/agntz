import {
	AuthRequiredError,
	requireUserContext,
	workerIdentity,
} from "@/lib/user";
import { workerRunsFetch } from "@/lib/worker-runs";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		const upstream = await workerRunsFetch({
			...workerIdentity(ctx),
			path: `/runs${req.nextUrl.search}`,
			signal: req.signal,
		});
		const body = await upstream.text();
		return new NextResponse(body, {
			status: upstream.status,
			headers: {
				"Content-Type":
					upstream.headers.get("Content-Type") ?? "application/json",
			},
		});
	} catch (err) {
		if (err instanceof AuthRequiredError) {
			return NextResponse.json({ error: err.message }, { status: err.status });
		}
		return NextResponse.json({ error: String(err) }, { status: 500 });
	}
}
