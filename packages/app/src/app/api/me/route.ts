import { isSuperAdmin } from "@/lib/admin";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

/** Returns the signed-in user's Clerk id + whether they're a super admin. */
export async function GET() {
	try {
		const {
			userId,
			actorUserId,
			tenantId,
			orgId,
			orgSlug,
			orgRole,
			roles,
			permissions,
		} = await requireUserContext();
		return NextResponse.json({
			userId,
			actorUserId,
			tenantId,
			orgId,
			orgSlug,
			orgRole,
			roles,
			permissions,
			isSuperAdmin: isSuperAdmin(actorUserId),
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
