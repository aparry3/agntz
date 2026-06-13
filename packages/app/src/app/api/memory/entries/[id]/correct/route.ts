import { requireSuperAdmin } from "@/lib/admin";
import { memoryErrorResponse } from "@/lib/memory-api";
import { requireUserContext } from "@/lib/user";
import { workerMemoryCorrect } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

/** Super-admin only — see /api/memory/topics for the tenancy rationale. */
export async function POST(
	req: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	try {
		const { actorUserId } = await requireUserContext();
		requireSuperAdmin(actorUserId);

		const { id } = await context.params;
		const body = (await req.json().catch(() => ({}))) as {
			grants?: unknown;
			content?: unknown;
		};
		if (!Array.isArray(body.grants) || body.grants.length === 0) {
			return NextResponse.json(
				{ error: "Missing required field: grants (string array)" },
				{ status: 400 },
			);
		}
		if (typeof body.content !== "string" || body.content.trim() === "") {
			return NextResponse.json(
				{ error: "Missing required field: content (non-empty string)" },
				{ status: 400 },
			);
		}

		const result = await workerMemoryCorrect({
			grants: body.grants as string[],
			id,
			content: body.content,
		});
		return NextResponse.json(result);
	} catch (error) {
		return memoryErrorResponse(error);
	}
}
