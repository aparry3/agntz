/**
 * Namespace-grant primitives now live in `@agntz/contracts` (the store and
 * resource adapters use them). Re-exported here so core's public surface and
 * internal imports are unchanged.
 */
export {
	isGrantNarrowedBy,
	isSameOrAncestorNamespace,
	isSameOrDescendantNamespace,
	namespaceAncestors,
	narrowNamespaceGrants,
	normalizeNamespaceGrant,
	normalizeNamespaceGrants,
	validateNamespaceGrantPolicy,
} from "@agntz/contracts";
export type {
	NamespaceGrant,
	NamespaceGrantPolicy,
	ProtectedNamespaceRule,
} from "@agntz/contracts";
