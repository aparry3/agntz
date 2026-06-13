import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
	hasAgntzPermission,
	normalizeAgntzRole,
	permissionsForRole,
	requiredPermissionForRequest,
} from "./lib/authz";

const isPublic = createRouteMatcher([
	"/sign-in(.*)",
	"/sign-up(.*)",
	"/api/health",
]);

export default clerkMiddleware(async (auth, req) => {
	if (!isPublic(req)) {
		const authState = await auth.protect();
		const required = requiredPermissionForRequest(
			req.nextUrl.pathname,
			req.method,
		);
		if (!required) return;

		const role = normalizeAgntzRole(
			authState.orgRole,
			Boolean(authState.orgId),
		);
		const permissions = permissionsForRole(role);
		if (hasAgntzPermission(permissions, required)) return;

		if (req.nextUrl.pathname.startsWith("/api/")) {
			return NextResponse.json(
				{ error: "forbidden", requiredPermission: required },
				{ status: 403 },
			);
		}
		return NextResponse.redirect(new URL("/agents", req.url));
	}
});

export const config = {
	matcher: ["/((?!_next|.*\\..*).*)", "/api/(.*)"],
};
