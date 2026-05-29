/**
 * Super-admin gate. There's no "super admin" row in the DB — system agents
 * and any other global concerns are code-level. This is a thin env-driven
 * check so the UI can surface admin tooling (view system-agent YAMLs, debug
 * system agent behavior) to specific Clerk user IDs without exposing it to
 * everyone.
 *
 * Set `SUPER_ADMIN_USER_IDS=user_abc,user_xyz` (comma-separated Clerk IDs)
 * in your env. The user's own Clerk ID is shown on /settings for easy copy.
 */
export function isSuperAdmin(userId: string | null | undefined): boolean {
	if (!userId) return false;
	const raw = process.env.SUPER_ADMIN_USER_IDS ?? "";
	const ids = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return ids.includes(userId);
}

export class ForbiddenError extends Error {
	status = 403;
	constructor(message = "Forbidden") {
		super(message);
	}
}

export function requireSuperAdmin(userId: string | null | undefined): void {
	if (!isSuperAdmin(userId)) throw new ForbiddenError();
}
