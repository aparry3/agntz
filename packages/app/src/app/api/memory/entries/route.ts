import { requireSuperAdmin } from "@/lib/admin";
import { memoryErrorResponse, parseGrantsParam } from "@/lib/memory-api";
import { requireUserContext } from "@/lib/user";
import { workerMemoryEntries } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

/** Super-admin only — see /api/memory/topics for the tenancy rationale. */
export async function GET(req: NextRequest) {
	try {
		const { actorUserId } = await requireUserContext();
		requireSuperAdmin(actorUserId);

		const grants = parseGrantsParam(req);
		if (grants.length === 0) {
			return NextResponse.json(
				{ error: "Missing required query param: grants" },
				{ status: 400 },
			);
		}
		const search = req.nextUrl.searchParams;
		const topics = (search.get("topics") ?? "")
			.split(",")
			.map((topic) => topic.trim())
			.filter((topic) => topic.length > 0);
		const limit = Number.parseInt(search.get("limit") ?? "", 10);
		const offset = Number.parseInt(search.get("offset") ?? "", 10);

		const page = await workerMemoryEntries({
			grants,
			topics: topics.length > 0 ? topics : undefined,
			includeSuperseded: search.get("includeSuperseded") === "true",
			limit: Number.isNaN(limit) ? undefined : limit,
			offset: Number.isNaN(offset) ? undefined : offset,
		});
		return NextResponse.json(page);
	} catch (error) {
		return memoryErrorResponse(error);
	}
}
