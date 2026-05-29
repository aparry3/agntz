import {
  isSameOrDescendantNamespace,
  namespaceAncestors,
  normalizeNamespaceGrant,
  normalizeNamespaceGrants,
} from "@agntz/core";
import type { NamespaceGrant, WritePolicy } from "./types.js";

export class MemrezScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemrezScopeError";
  }
}

export const DEFAULT_WRITE_POLICY: Required<WritePolicy> = {
  descendants: true,
  ancestorPromotion: "none",
};

export function normalizeWritePolicy(policy: WritePolicy | undefined): Required<WritePolicy> {
  return {
    descendants: policy?.descendants ?? DEFAULT_WRITE_POLICY.descendants,
    ancestorPromotion: policy?.ancestorPromotion ?? DEFAULT_WRITE_POLICY.ancestorPromotion,
  };
}

export function normalizeGrants(grants: readonly unknown[]): NamespaceGrant[] {
  const normalized = normalizeNamespaceGrants(grants);
  if (normalized.length === 0) {
    throw new MemrezScopeError("memrez operations require at least one namespace grant");
  }
  return normalized;
}

export function visibleScopes(grants: NamespaceGrant[], includeAncestors = true): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const grant of grants) {
    const scopes = includeAncestors ? namespaceAncestors(grant) : [normalizeNamespaceGrant(grant)];
    for (const scope of scopes) {
      if (!seen.has(scope)) {
        seen.add(scope);
        out.push(scope);
      }
    }
  }
  return out;
}

export function assertReadableScope(grants: NamespaceGrant[], target: string): string {
  const normalizedTarget = normalizeNamespaceGrant(target);
  const readable = visibleScopes(grants, true).includes(normalizedTarget);
  if (!readable) {
    throw new MemrezScopeError(`scope '${target}' is not readable from grants [${grants.join(", ")}]`);
  }
  return normalizedTarget;
}

export function assertWritableScope(
  grants: NamespaceGrant[],
  target: string,
  policy: Required<WritePolicy>,
): string {
  const normalizedTarget = normalizeNamespaceGrant(target);
  for (const grant of grants) {
    if (normalizedTarget === grant) return normalizedTarget;
    if (policy.descendants && isSameOrDescendantNamespace(normalizedTarget, grant)) {
      return normalizedTarget;
    }
    if (isAllowedAncestorPromotion(grant, normalizedTarget, policy.ancestorPromotion)) {
      return normalizedTarget;
    }
  }
  throw new MemrezScopeError(
    `scope '${target}' is not writable from grants [${grants.join(", ")}] with ancestorPromotion=${policy.ancestorPromotion}`,
  );
}

function isAllowedAncestorPromotion(
  grant: NamespaceGrant,
  target: string,
  promotion: Required<WritePolicy>["ancestorPromotion"],
): boolean {
  if (promotion === "none") return false;
  const ancestors = namespaceAncestors(grant);
  const targetIndex = ancestors.indexOf(target);
  if (targetIndex === -1 || target === grant) return false;
  if (promotion === "ancestors") return true;
  return promotion === "parent" && targetIndex === ancestors.length - 2;
}
