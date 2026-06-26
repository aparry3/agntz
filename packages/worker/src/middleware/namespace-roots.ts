import {
	type AllowedRoots,
	ForbiddenError,
	NAMESPACE_UNBOUNDED_PERMISSION,
	type NamespaceRootStore,
	assertScopeWithinRoots,
	narrowToRoots,
	readScopes,
	resolveAllowedRoots as resolveAllowedRootsForContext,
} from "@agntz/stores/contracts";
import type { Context } from "hono";
import { getAuthMethod, getPermissions, getTenantId } from "./auth.js";

export {
	ForbiddenError,
	NAMESPACE_UNBOUNDED_PERMISSION,
	assertScopeWithinRoots,
	narrowToRoots,
	readScopes,
};
export type { AllowedRoots };

export async function resolveAllowedRoots(
	c: Context,
	store: NamespaceRootStore,
): Promise<AllowedRoots> {
	return resolveAllowedRootsForContext(
		{
			tenantId: getTenantId(c),
			authMethod: getAuthMethod(c),
			permissions: getPermissions(c),
		},
		store,
	);
}
