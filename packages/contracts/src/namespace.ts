import { NamespaceGrantError } from "./errors.js";

export type NamespaceGrant = string;

export interface ProtectedNamespaceRule {
	/**
	 * Namespace branch whose broad grants are sensitive. By default, grants at
	 * this namespace or any ancestor of it are rejected, while grants below it
	 * must include at least one descendant segment.
	 */
	namespace: string;
	/**
	 * Minimum number of path segments required below `namespace`.
	 * Defaults to 1, e.g. protecting `app/private/users` allows
	 * `app/private/users/u_123` but rejects `app/private/users`.
	 */
	minDescendantSegments?: number;
	/** Allows a grant exactly equal to `namespace`. Defaults false. */
	allowBoundaryGrant?: boolean;
	/** Allows grants above `namespace`, such as `app`. Defaults false. */
	allowAncestorGrants?: boolean;
}

export interface NamespaceGrantPolicy {
	protectedNamespaces?: readonly ProtectedNamespaceRule[];
}

/**
 * Namespace paths are intentionally plain strings. They are capabilities
 * minted by trusted application code, so keep parsing strict and predictable.
 */
export function normalizeNamespaceGrant(input: unknown): NamespaceGrant {
	if (typeof input !== "string") {
		throw new NamespaceGrantError(input, "grant must be a string");
	}
	if (input.length === 0) {
		throw new NamespaceGrantError(input, "grant must not be empty");
	}
	if (input.trim() !== input) {
		throw new NamespaceGrantError(
			input,
			"grant must not contain leading or trailing whitespace",
		);
	}
	if (input.startsWith("/") || input.endsWith("/")) {
		throw new NamespaceGrantError(
			input,
			"grant must not start or end with '/'",
		);
	}
	if (input.includes("//")) {
		throw new NamespaceGrantError(
			input,
			"grant must not contain empty path segments",
		);
	}

	const segments = input.split("/");
	for (const segment of segments) {
		if (segment === "." || segment === "..") {
			throw new NamespaceGrantError(
				input,
				"grant must not contain traversal segments",
			);
		}
		if (segment.includes("*")) {
			throw new NamespaceGrantError(input, "grant must not contain wildcards");
		}
		if (/\s/.test(segment)) {
			throw new NamespaceGrantError(
				input,
				"grant segments must not contain whitespace",
			);
		}
	}
	return input;
}

export function normalizeNamespaceGrants(
	input: readonly unknown[] | undefined,
	policy?: NamespaceGrantPolicy,
): NamespaceGrant[] {
	if (input === undefined) return [];
	if (!Array.isArray(input)) {
		throw new NamespaceGrantError(
			input,
			"context must be an array of namespace grants",
		);
	}

	const seen = new Set<string>();
	const out: NamespaceGrant[] = [];
	for (const raw of input) {
		const grant = normalizeNamespaceGrant(raw);
		if (!seen.has(grant)) {
			seen.add(grant);
			out.push(grant);
		}
	}
	validateNamespaceGrantPolicy(out, policy);
	return out;
}

export function namespaceAncestors(grant: NamespaceGrant): NamespaceGrant[] {
	const normalized = normalizeNamespaceGrant(grant);
	const segments = normalized.split("/");
	const ancestors: NamespaceGrant[] = [];
	for (let i = 1; i <= segments.length; i++) {
		ancestors.push(segments.slice(0, i).join("/"));
	}
	return ancestors;
}

export function isSameOrAncestorNamespace(
	candidate: NamespaceGrant,
	grant: NamespaceGrant,
): boolean {
	const normalizedCandidate = normalizeNamespaceGrant(candidate);
	const normalizedGrant = normalizeNamespaceGrant(grant);
	return (
		normalizedGrant === normalizedCandidate ||
		normalizedGrant.startsWith(`${normalizedCandidate}/`)
	);
}

export function isSameOrDescendantNamespace(
	candidate: NamespaceGrant,
	grant: NamespaceGrant,
): boolean {
	const normalizedCandidate = normalizeNamespaceGrant(candidate);
	const normalizedGrant = normalizeNamespaceGrant(grant);
	return (
		normalizedCandidate === normalizedGrant ||
		normalizedCandidate.startsWith(`${normalizedGrant}/`)
	);
}

export function isGrantNarrowedBy(
	parent: NamespaceGrant,
	child: NamespaceGrant,
): boolean {
	return isSameOrDescendantNamespace(child, parent);
}

export function narrowNamespaceGrants(
	parentGrants: readonly NamespaceGrant[],
	requestedGrants: readonly unknown[] | undefined,
	policy?: NamespaceGrantPolicy,
): NamespaceGrant[] {
	const normalizedParents = normalizeNamespaceGrants(parentGrants, policy);
	if (requestedGrants === undefined) return normalizedParents;

	const requested = normalizeNamespaceGrants(requestedGrants, policy);
	for (const grant of requested) {
		if (!normalizedParents.some((parent) => isGrantNarrowedBy(parent, grant))) {
			throw new NamespaceGrantError(
				grant,
				`grant is not within parent context [${normalizedParents.join(", ")}]`,
			);
		}
	}
	return requested;
}

export function validateNamespaceGrantPolicy(
	grants: readonly NamespaceGrant[],
	policy: NamespaceGrantPolicy | undefined,
): void {
	if (!policy?.protectedNamespaces?.length) return;
	for (const grant of grants) {
		const normalizedGrant = normalizeNamespaceGrant(grant);
		for (const rule of policy.protectedNamespaces) {
			assertProtectedNamespaceRule(normalizedGrant, rule);
		}
	}
}

function assertProtectedNamespaceRule(
	grant: NamespaceGrant,
	rule: ProtectedNamespaceRule,
): void {
	const boundary = normalizeNamespaceGrant(rule.namespace);
	const minDescendantSegments = rule.minDescendantSegments ?? 1;
	if (!Number.isInteger(minDescendantSegments) || minDescendantSegments < 0) {
		throw new NamespaceGrantError(
			boundary,
			"protected namespace minDescendantSegments must be a non-negative integer",
		);
	}

	if (grant === boundary) {
		if (rule.allowBoundaryGrant) return;
		throw new NamespaceGrantError(
			grant,
			`grant is exactly protected namespace '${boundary}'; grant a narrower descendant or explicitly allow boundary grants`,
		);
	}

	if (isSameOrAncestorNamespace(grant, boundary)) {
		if (rule.allowAncestorGrants) return;
		throw new NamespaceGrantError(
			grant,
			`grant is above protected namespace '${boundary}'; grant a narrower descendant instead`,
		);
	}

	if (isSameOrDescendantNamespace(grant, boundary)) {
		const extraSegments = grant.split("/").length - boundary.split("/").length;
		if (extraSegments < minDescendantSegments) {
			throw new NamespaceGrantError(
				grant,
				`grant must include at least ${minDescendantSegments} descendant segment(s) below protected namespace '${boundary}'`,
			);
		}
	}
}
