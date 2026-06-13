import { ForbiddenError } from "@/lib/admin";
import { AuthRequiredError } from "@/lib/user";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/** Parse the comma-separated `grants` query param. */
export function parseGrantsParam(req: NextRequest): string[] {
	return (req.nextUrl.searchParams.get("grants") ?? "")
		.split(",")
		.map((grant) => grant.trim())
		.filter((grant) => grant.length > 0);
}

/**
 * Shared error mapping for the /api/memory/* proxy routes. Worker-side
 * validation errors arrive as generic Errors with the worker's message —
 * surface them as 400s rather than opaque 500s.
 */
export function memoryErrorResponse(error: unknown) {
	if (error instanceof AuthRequiredError || error instanceof ForbiddenError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
