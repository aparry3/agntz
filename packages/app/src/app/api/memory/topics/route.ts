import { requireSuperAdmin } from "@/lib/admin";
import { memoryErrorResponse, parseGrantsParam } from "@/lib/memory-api";
import { requireUserContext } from "@/lib/user";
import { workerMemoryTopics } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Memory observability is super-admin only until scopes are tenant-prefixed
 * (memory-observability plan §D8 / encryption plan §5): grants are taken
 * verbatim, so exposing this to every signed-in user would let one tenant
 * read another's scopes.
 */
export async function GET(req: NextRequest) {
	try {
		const { userId } = await requireUserContext();
		requireSuperAdmin(userId);

		const grants = parseGrantsParam(req);
		if (grants.length === 0) {
			return NextResponse.json(
				{ error: "Missing required query param: grants" },
				{ status: 400 },
			);
		}
		return NextResponse.json(await workerMemoryTopics(grants));
	} catch (error) {
		return memoryErrorResponse(error);
	}
}
