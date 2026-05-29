"""Namespace grant helpers shared by Python clients and memrez."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any


class NamespaceGrantError(ValueError):
    def __init__(self, input_value: Any, detail: str) -> None:
        super().__init__(f'Invalid namespace grant "{input_value}": {detail}')
        self.input = input_value
        self.code = "NAMESPACE_GRANT_INVALID"


NamespaceGrant = str


@dataclass(frozen=True)
class ProtectedNamespaceRule:
    namespace: str
    min_descendant_segments: int = 1
    allow_boundary_grant: bool = False
    allow_ancestor_grants: bool = False


@dataclass(frozen=True)
class NamespaceGrantPolicy:
    protected_namespaces: Sequence[ProtectedNamespaceRule | Mapping[str, Any]] = ()


def normalize_namespace_grant(input_value: Any) -> NamespaceGrant:
    if not isinstance(input_value, str):
        raise NamespaceGrantError(input_value, "grant must be a string")
    if input_value == "":
        raise NamespaceGrantError(input_value, "grant must not be empty")
    if input_value.strip() != input_value:
        raise NamespaceGrantError(
            input_value,
            "grant must not contain leading or trailing whitespace",
        )
    if input_value.startswith("/") or input_value.endswith("/"):
        raise NamespaceGrantError(input_value, "grant must not start or end with '/'")
    if "//" in input_value:
        raise NamespaceGrantError(input_value, "grant must not contain empty path segments")

    for segment in input_value.split("/"):
        if segment in {".", ".."}:
            raise NamespaceGrantError(input_value, "grant must not contain traversal segments")
        if "*" in segment:
            raise NamespaceGrantError(input_value, "grant must not contain wildcards")
        if re.search(r"\s", segment):
            raise NamespaceGrantError(input_value, "grant segments must not contain whitespace")
    return input_value


NamespaceGrantPolicyLike = NamespaceGrantPolicy | Mapping[str, Any] | None


def normalize_namespace_grants(
    input_value: Sequence[Any] | None,
    policy: NamespaceGrantPolicyLike = None,
) -> list[NamespaceGrant]:
    if input_value is None:
        return []
    if isinstance(input_value, str) or not isinstance(input_value, Sequence):
        raise NamespaceGrantError(input_value, "context must be an array of namespace grants")

    seen: set[str] = set()
    output: list[NamespaceGrant] = []
    for raw in input_value:
        grant = normalize_namespace_grant(raw)
        if grant not in seen:
            seen.add(grant)
            output.append(grant)
    validate_namespace_grant_policy(output, policy)
    return output


def namespace_ancestors(grant: NamespaceGrant) -> list[NamespaceGrant]:
    normalized = normalize_namespace_grant(grant)
    segments = normalized.split("/")
    return ["/".join(segments[:index]) for index in range(1, len(segments) + 1)]


def is_same_or_ancestor_namespace(candidate: NamespaceGrant, grant: NamespaceGrant) -> bool:
    normalized_candidate = normalize_namespace_grant(candidate)
    normalized_grant = normalize_namespace_grant(grant)
    return normalized_grant == normalized_candidate or normalized_grant.startswith(
        f"{normalized_candidate}/"
    )


def is_same_or_descendant_namespace(candidate: NamespaceGrant, grant: NamespaceGrant) -> bool:
    normalized_candidate = normalize_namespace_grant(candidate)
    normalized_grant = normalize_namespace_grant(grant)
    return normalized_candidate == normalized_grant or normalized_candidate.startswith(
        f"{normalized_grant}/"
    )


def is_grant_narrowed_by(parent: NamespaceGrant, child: NamespaceGrant) -> bool:
    return is_same_or_descendant_namespace(child, parent)


def narrow_namespace_grants(
    parent_grants: Sequence[NamespaceGrant],
    requested_grants: Sequence[Any] | None,
    policy: NamespaceGrantPolicyLike = None,
) -> list[NamespaceGrant]:
    normalized_parents = normalize_namespace_grants(parent_grants, policy)
    if requested_grants is None:
        return normalized_parents

    requested = normalize_namespace_grants(requested_grants, policy)
    for grant in requested:
        if not any(is_grant_narrowed_by(parent, grant) for parent in normalized_parents):
            raise NamespaceGrantError(
                grant,
                f"grant is not within parent context [{', '.join(normalized_parents)}]",
            )
    return requested


def validate_namespace_grant_policy(
    grants: Sequence[NamespaceGrant],
    policy: NamespaceGrantPolicyLike = None,
) -> None:
    for grant in grants:
        normalized_grant = normalize_namespace_grant(grant)
        for rule in _protected_namespace_rules(policy):
            _assert_protected_namespace_rule(normalized_grant, rule)


def _assert_protected_namespace_rule(
    grant: NamespaceGrant,
    rule: ProtectedNamespaceRule,
) -> None:
    boundary = normalize_namespace_grant(rule.namespace)
    min_descendant_segments = rule.min_descendant_segments
    if not isinstance(min_descendant_segments, int) or min_descendant_segments < 0:
        raise NamespaceGrantError(
            boundary,
            "protected namespace min_descendant_segments must be a non-negative integer",
        )

    if grant == boundary:
        if rule.allow_boundary_grant:
            return
        raise NamespaceGrantError(
            grant,
            f"grant is exactly protected namespace '{boundary}'; "
            "grant a narrower descendant or explicitly allow boundary grants",
        )

    if is_same_or_ancestor_namespace(grant, boundary):
        if rule.allow_ancestor_grants:
            return
        raise NamespaceGrantError(
            grant,
            f"grant is above protected namespace '{boundary}'; grant a narrower descendant instead",
        )

    if is_same_or_descendant_namespace(grant, boundary):
        extra_segments = len(grant.split("/")) - len(boundary.split("/"))
        if extra_segments < min_descendant_segments:
            raise NamespaceGrantError(
                grant,
                f"grant must include at least {min_descendant_segments} "
                f"descendant segment(s) below protected namespace '{boundary}'",
            )


def _protected_namespace_rules(
    policy: NamespaceGrantPolicyLike,
) -> list[ProtectedNamespaceRule]:
    if policy is None:
        return []
    raw_rules: Sequence[ProtectedNamespaceRule | Mapping[str, Any]]
    if isinstance(policy, NamespaceGrantPolicy):
        raw_rules = policy.protected_namespaces
    elif isinstance(policy, Mapping):
        raw_value = policy.get("protectedNamespaces", policy.get("protected_namespaces", ()))
        raw_rules = (
            raw_value if isinstance(raw_value, Sequence) and not isinstance(raw_value, str) else ()
        )
    else:
        raw_rules = ()

    return [_normalize_protected_namespace_rule(rule) for rule in raw_rules]


def _normalize_protected_namespace_rule(
    rule: ProtectedNamespaceRule | Mapping[str, Any],
) -> ProtectedNamespaceRule:
    if isinstance(rule, ProtectedNamespaceRule):
        return rule
    return ProtectedNamespaceRule(
        namespace=str(rule["namespace"]),
        min_descendant_segments=int(
            rule.get(
                "minDescendantSegments",
                rule.get("min_descendant_segments", 1),
            )
        ),
        allow_boundary_grant=bool(
            rule.get("allowBoundaryGrant", rule.get("allow_boundary_grant", False))
        ),
        allow_ancestor_grants=bool(
            rule.get("allowAncestorGrants", rule.get("allow_ancestor_grants", False))
        ),
    )
