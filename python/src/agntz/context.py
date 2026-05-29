"""Namespace grant helpers shared by Python clients and memrez."""

from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any


class NamespaceGrantError(ValueError):
    def __init__(self, input_value: Any, detail: str) -> None:
        super().__init__(f'Invalid namespace grant "{input_value}": {detail}')
        self.input = input_value
        self.code = "NAMESPACE_GRANT_INVALID"


NamespaceGrant = str


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


def normalize_namespace_grants(input_value: Sequence[Any] | None) -> list[NamespaceGrant]:
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
) -> list[NamespaceGrant]:
    normalized_parents = normalize_namespace_grants(parent_grants)
    if requested_grants is None:
        return normalized_parents

    requested = normalize_namespace_grants(requested_grants)
    for grant in requested:
        if not any(is_grant_narrowed_by(parent, grant) for parent in normalized_parents):
            raise NamespaceGrantError(
                grant,
                f"grant is not within parent context [{', '.join(normalized_parents)}]",
            )
    return requested
