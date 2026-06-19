"""Hosted-platform contracts and policy helpers for Python Agntz."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from agntz.context import (
    NamespaceGrantError,
    is_same_or_descendant_namespace,
    namespace_ancestors,
    narrow_namespace_grants,
    normalize_namespace_grant,
)

NAMESPACE_UNBOUNDED_PERMISSION = "namespace:unbounded"
NO_ROOTS_MESSAGE = (
    "tenant has no registered namespace roots; register one before using "
    "memory or scope operations"
)


class ApiKeyStore(Protocol):
    def create_api_key(self, *, user_id: str, name: str) -> dict[str, Any]: ...

    def list_api_keys(self, user_id: str) -> list[Any]: ...

    def revoke_api_key(self, *, user_id: str, key_id: str) -> None: ...

    def resolve_api_key(self, raw_key: str) -> dict[str, str] | None: ...


class NamespaceRootStore(Protocol):
    def list_namespace_roots(self, user_id: str) -> list[str]: ...

    def add_namespace_root(self, user_id: str, root: str) -> None: ...

    def remove_namespace_root(self, user_id: str, root: str) -> None: ...


class PlatformStore(ApiKeyStore, NamespaceRootStore, Protocol):
    """Hosted store capabilities layered on top of local/core storage."""


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    auth_method: str
    permissions: list[str]


@dataclass(frozen=True)
class AllowedRoots:
    unbounded: bool
    roots: list[str]


class ForbiddenError(Exception):
    """Raised when hosted namespace policy rejects a memory/scope request."""


def resolve_allowed_roots(ctx: AuthContext, store: NamespaceRootStore) -> AllowedRoots:
    if (
        ctx.auth_method != "api_key"
        and NAMESPACE_UNBOUNDED_PERMISSION in ctx.permissions
    ):
        return AllowedRoots(unbounded=True, roots=[])
    return AllowedRoots(unbounded=False, roots=store.list_namespace_roots(ctx.user_id))


def narrow_to_roots(allowed: AllowedRoots, requested: Sequence[str]) -> list[str]:
    if allowed.unbounded:
        return list(requested)
    if not allowed.roots:
        raise ForbiddenError(NO_ROOTS_MESSAGE)
    return narrow_namespace_grants(allowed.roots, list(requested))


def read_scopes(
    allowed: AllowedRoots,
    requested: Sequence[str],
) -> tuple[list[str], bool]:
    if allowed.unbounded:
        return list(requested), True
    narrowed = narrow_to_roots(allowed, requested)
    seen: set[str] = set()
    scopes: list[str] = []
    for grant in narrowed:
        for ancestor in namespace_ancestors(grant):
            if ancestor in seen:
                continue
            if any(is_same_or_descendant_namespace(ancestor, root) for root in allowed.roots):
                seen.add(ancestor)
                scopes.append(ancestor)
    return scopes, False


def assert_scope_within_roots(allowed: AllowedRoots, scope: str) -> str:
    normalized = normalize_namespace_grant(scope)
    if allowed.unbounded:
        return normalized
    if not allowed.roots:
        raise ForbiddenError(NO_ROOTS_MESSAGE)
    if not any(is_same_or_descendant_namespace(normalized, root) for root in allowed.roots):
        raise NamespaceGrantError(
            normalized,
            f"scope is not within tenant roots [{', '.join(allowed.roots)}]",
        )
    return normalized


__all__ = [
    "AllowedRoots",
    "ApiKeyStore",
    "AuthContext",
    "ForbiddenError",
    "NAMESPACE_UNBOUNDED_PERMISSION",
    "NamespaceRootStore",
    "PlatformStore",
    "assert_scope_within_roots",
    "narrow_to_roots",
    "read_scopes",
    "resolve_allowed_roots",
]
