import { NamespaceGrantError } from "./errors.js";

export type NamespaceGrant = string;

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
    throw new NamespaceGrantError(input, "grant must not contain leading or trailing whitespace");
  }
  if (input.startsWith("/") || input.endsWith("/")) {
    throw new NamespaceGrantError(input, "grant must not start or end with '/'");
  }
  if (input.includes("//")) {
    throw new NamespaceGrantError(input, "grant must not contain empty path segments");
  }

  const segments = input.split("/");
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new NamespaceGrantError(input, "grant must not contain traversal segments");
    }
    if (segment.includes("*")) {
      throw new NamespaceGrantError(input, "grant must not contain wildcards");
    }
    if (/\s/.test(segment)) {
      throw new NamespaceGrantError(input, "grant segments must not contain whitespace");
    }
  }
  return input;
}

export function normalizeNamespaceGrants(input: readonly unknown[] | undefined): NamespaceGrant[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) {
    throw new NamespaceGrantError(input, "context must be an array of namespace grants");
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

export function isSameOrAncestorNamespace(candidate: NamespaceGrant, grant: NamespaceGrant): boolean {
  const normalizedCandidate = normalizeNamespaceGrant(candidate);
  const normalizedGrant = normalizeNamespaceGrant(grant);
  return normalizedGrant === normalizedCandidate || normalizedGrant.startsWith(`${normalizedCandidate}/`);
}

export function isSameOrDescendantNamespace(candidate: NamespaceGrant, grant: NamespaceGrant): boolean {
  const normalizedCandidate = normalizeNamespaceGrant(candidate);
  const normalizedGrant = normalizeNamespaceGrant(grant);
  return normalizedCandidate === normalizedGrant || normalizedCandidate.startsWith(`${normalizedGrant}/`);
}

export function isGrantNarrowedBy(parent: NamespaceGrant, child: NamespaceGrant): boolean {
  return isSameOrDescendantNamespace(child, parent);
}

export function narrowNamespaceGrants(
  parentGrants: readonly NamespaceGrant[],
  requestedGrants: readonly unknown[] | undefined,
): NamespaceGrant[] {
  const normalizedParents = normalizeNamespaceGrants(parentGrants);
  if (requestedGrants === undefined) return normalizedParents;

  const requested = normalizeNamespaceGrants(requestedGrants);
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
