import { ForbiddenError, requireSuperAdmin } from "@/lib/admin";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { workerListSystemAgents } from "@/lib/worker-client";
import { NextResponse } from "next/server";

export async function GET() {
	try {
		const { actorUserId } = await requireUserContext();
		requireSuperAdmin(actorUserId);

		const agents = await workerListSystemAgents();
		return NextResponse.json(agents);
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	if (error instanceof ForbiddenError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
