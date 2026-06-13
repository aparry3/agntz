export type AgntzPermission =
	| "agents:read"
	| "agents:write"
	| "agents:run"
	| "api_keys:manage"
	| "connections:manage"
	| "evals:read"
	| "evals:write"
	| "evals:run"
	| "providers:manage"
	| "runs:read"
	| "runs:cancel"
	| "secrets:manage"
	| "settings:read"
	| "skills:read"
	| "skills:write"
	| "traces:read";

export type AgntzRole = "owner" | "admin" | "developer" | "operator" | "viewer";

const ALL_PERMISSIONS: AgntzPermission[] = [
	"agents:read",
	"agents:write",
	"agents:run",
	"api_keys:manage",
	"connections:manage",
	"evals:read",
	"evals:write",
	"evals:run",
	"providers:manage",
	"runs:read",
	"runs:cancel",
	"secrets:manage",
	"settings:read",
	"skills:read",
	"skills:write",
	"traces:read",
];

const ROLE_PERMISSIONS: Record<AgntzRole, AgntzPermission[]> = {
	owner: ALL_PERMISSIONS,
	admin: ALL_PERMISSIONS,
	developer: [
		"agents:read",
		"agents:write",
		"agents:run",
		"connections:manage",
		"evals:read",
		"evals:write",
		"evals:run",
		"providers:manage",
		"runs:read",
		"runs:cancel",
		"settings:read",
		"skills:read",
		"skills:write",
		"traces:read",
	],
	operator: [
		"agents:read",
		"agents:run",
		"evals:read",
		"evals:run",
		"runs:read",
		"runs:cancel",
		"settings:read",
		"skills:read",
		"traces:read",
	],
	viewer: [
		"agents:read",
		"evals:read",
		"runs:read",
		"settings:read",
		"skills:read",
		"traces:read",
	],
};

export function normalizeAgntzRole(
	clerkOrgRole: string | null | undefined,
	hasActiveOrg: boolean,
): AgntzRole {
	if (!hasActiveOrg) return "owner";
	const role = (clerkOrgRole ?? "").replace(/^org:/, "").toLowerCase();
	if (role === "owner") return "owner";
	if (role === "admin") return "admin";
	if (role === "operator") return "operator";
	if (role === "viewer") return "viewer";
	return "developer";
}

export function permissionsForRole(role: AgntzRole): AgntzPermission[] {
	return ROLE_PERMISSIONS[role];
}

export function hasAgntzPermission(
	permissions: readonly string[] | null | undefined,
	required: AgntzPermission,
): boolean {
	return permissions?.includes(required) ?? false;
}

export function requiredPermissionForRequest(
	pathname: string,
	method: string,
): AgntzPermission | null {
	const m = method.toUpperCase();
	const mutates = !["GET", "HEAD", "OPTIONS"].includes(m);

	if (pathname === "/api/me" || pathname === "/api/health") return null;
	if (pathname.startsWith("/api/system") || pathname.startsWith("/system")) {
		return null;
	}

	if (pathname.startsWith("/settings/api-keys")) return "api_keys:manage";
	if (pathname.startsWith("/settings/secrets")) return "secrets:manage";
	if (pathname.startsWith("/settings")) return "settings:read";

	if (pathname.startsWith("/api/api-keys")) return "api_keys:manage";
	if (pathname.startsWith("/api/secrets")) return "secrets:manage";
	if (pathname.startsWith("/api/providers")) return "providers:manage";
	if (
		pathname.startsWith("/api/connections") ||
		pathname.startsWith("/api/mcp-servers") ||
		pathname.startsWith("/api/mcp-tools")
	) {
		return "connections:manage";
	}

	if (pathname.startsWith("/api/run")) return "agents:run";
	if (pathname.startsWith("/api/runs")) {
		return pathname.endsWith("/cancel") ? "runs:cancel" : "runs:read";
	}
	if (pathname.startsWith("/api/traces")) return "traces:read";
	if (pathname.startsWith("/api/logs")) return "runs:read";
	if (pathname.startsWith("/api/sessions"))
		return mutates ? "runs:cancel" : "runs:read";

	if (pathname.startsWith("/api/agents/build")) return "agents:write";
	if (pathname.startsWith("/api/agents/validate")) return "agents:write";
	if (pathname.startsWith("/api/agents")) {
		return mutates ? "agents:write" : "agents:read";
	}
	if (pathname.startsWith("/api/skills")) {
		return mutates ? "skills:write" : "skills:read";
	}
	if (
		pathname.startsWith("/api/evals") ||
		pathname.startsWith("/api/datasets")
	) {
		return mutates ? "evals:write" : "evals:read";
	}
	if (pathname.startsWith("/api/eval-runs")) {
		return m === "POST" ? "evals:run" : "evals:read";
	}
	if (pathname.startsWith("/api/eval-scores")) return "evals:read";

	if (pathname.startsWith("/agents")) return "agents:read";
	if (pathname.startsWith("/skills")) return "skills:read";
	if (pathname.startsWith("/runs")) return "runs:read";
	if (pathname.startsWith("/traces")) return "traces:read";
	if (pathname.startsWith("/logs")) return "runs:read";
	if (pathname.startsWith("/sessions")) return "runs:read";

	return null;
}
