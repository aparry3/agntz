import {
	NamespaceGrantError,
	isSameOrDescendantNamespace,
	namespaceAncestors,
	narrowNamespaceGrants,
	normalizeNamespaceGrant,
} from "@agntz/contracts";
import type { NamespaceRootStore } from "./types.js";

/**
 * Permission sentinel the app appends for super-admins to grant unbounded
 * cross-tenant memory/scope access. API-key callers must never receive this.
 */
export const NAMESPACE_UNBOUNDED_PERMISSION = "namespace:unbounded";

export class ForbiddenError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ForbiddenError";
	}
}

export type AllowedRoots =
	| { unbounded: true }
	| { unbounded: false; roots: string[] };

export interface NamespacePolicyAuthContext {
	tenantId: string;
	authMethod?: string;
	permissions?: readonly string[];
}

export async function resolveAllowedRoots(
	ctx: NamespacePolicyAuthContext,
	store: NamespaceRootStore,
): Promise<AllowedRoots> {
	if (
		ctx.authMethod !== "api_key" &&
		ctx.permissions?.includes(NAMESPACE_UNBOUNDED_PERMISSION)
	) {
		return { unbounded: true };
	}
	const roots = await store.listNamespaceRoots(ctx.tenantId);
	return { unbounded: false, roots };
}

const NO_ROOTS_MESSAGE =
	"tenant has no registered namespace roots; register one before using memory/scope operations";

export function narrowToRoots(
	allowed: AllowedRoots,
	requestedGrants: string[],
): string[] {
	if (allowed.unbounded) return requestedGrants;
	if (allowed.roots.length === 0) throw new ForbiddenError(NO_ROOTS_MESSAGE);
	return narrowNamespaceGrants(allowed.roots, requestedGrants);
}

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
