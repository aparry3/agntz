import {
	NamespaceGrantError,
	type NamespaceRootStore,
	isSameOrDescendantNamespace,
	namespaceAncestors,
	narrowNamespaceGrants,
	normalizeNamespaceGrant,
} from "@agntz/core";
import type { Context } from "hono";
import { getAuthMethod, getPermissions, getTenantId } from "./auth.js";

/**
 * Permission sentinel the app appends (only for super-admins) to grant unbounded
 * cross-tenant memory/scope access. The worker honors it ONLY for non-API-key
 * auth (API-key/legacy paths always set `permissions: []`), so an API key can
 * never claim it.
 */
export const NAMESPACE_UNBOUNDED_PERMISSION = "namespace:unbounded";

/** Raised when a tenant tries a bounded op with no registered roots → HTTP 403. */
export class ForbiddenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ForbiddenError";
	}
}

export type AllowedRoots =
	| { unbounded: true }
	| { unbounded: false; roots: string[] };

/**
 * Resolve which namespace roots the current caller may operate within.
 * - Super-admin (non-API-key auth carrying the unbounded sentinel) → unbounded.
 * - Otherwise → the tenant's registered roots from the store (possibly empty).
 */
export async function resolveAllowedRoots(
	c: Context,
	store: NamespaceRootStore,
): Promise<AllowedRoots> {
	if (
		getAuthMethod(c) !== "api_key" &&
		getPermissions(c).includes(NAMESPACE_UNBOUNDED_PERMISSION)
	) {
		return { unbounded: true };
	}
	const roots = await store.listNamespaceRoots(getTenantId(c));
	return { unbounded: false, roots };
}

const NO_ROOTS_MESSAGE =
	"tenant has no registered namespace roots; register one before using memory/scope operations";

/**
 * Bound requested grants to the caller's allowed roots:
 * - unbounded → passthrough;
 * - roots present → `narrowNamespaceGrants` (throws `NamespaceGrantError` → 400 if any grant escapes);
 * - no roots (non-admin) → `ForbiddenError` → 403.
 */
export function narrowToRoots(
	allowed: AllowedRoots,
	requestedGrants: string[],
): string[] {
	if (allowed.unbounded) return requestedGrants;
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	return narrowNamespaceGrants(allowed.roots, requestedGrants);
}

/**
 * Resolve the exact scope set a caller may READ (for /memory/topics + /entries).
 * Mirrors what an agent sees — grant + ancestors — but for bounded callers CLAMPS
 * the expanded set to the tenant's roots: within-root ancestors stay visible
 * (preserving "view what the agent sees"), scopes ABOVE the roots are dropped.
 * Returns the scopes plus the `includeAncestors` flag to hand memrez:
 * - unbounded → pass the grants through and let memrez expand (includeAncestors=true);
 * - bounded   → return the pre-expanded, clamped scope set with includeAncestors=false.
 */
export function readScopes(
	allowed: AllowedRoots,
	requestedGrants: string[],
): { scopes: string[]; includeAncestors: boolean } {
	if (allowed.unbounded) {
		return { scopes: requestedGrants, includeAncestors: true };
	}
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	const narrowed = narrowNamespaceGrants(allowed.roots, requestedGrants);
	const seen = new Set<string>();
	const scopes: string[] = [];
	for (const grant of narrowed) {
		for (const ancestor of namespaceAncestors(grant)) {
			if (seen.has(ancestor)) continue;
			// Keep only scopes at-or-below a root (drop ancestors above the roots).
			if (
				allowed.roots.some((root) =>
					isSameOrDescendantNamespace(ancestor, root),
				)
			) {
				seen.add(ancestor);
				scopes.push(ancestor);
			}
		}
	}
	return { scopes, includeAncestors: false };
}

/** Single-scope variant for `POST /scopes/delete`. Returns the normalized scope. */
export function assertScopeWithinRoots(
	allowed: AllowedRoots,
	scope: string,
): string {
	const normalized = normalizeNamespaceGrant(scope);
	if (allowed.unbounded) return normalized;
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	const withinRoot = allowed.roots.some((root) =>
		isSameOrDescendantNamespace(normalized, root),
	);
	if (!withinRoot) {
		throw new NamespaceGrantError(
			normalized,
			`scope is not within tenant roots [${allowed.roots.join(", ")}]`,
		);
	}
	return normalized;
}
