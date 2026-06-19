from __future__ import annotations

import pytest

from agntz.context import NamespaceGrantError
from agntz.platform import (
    AuthContext,
    ForbiddenError,
    assert_scope_within_roots,
    narrow_to_roots,
    read_scopes,
    resolve_allowed_roots,
)
from agntz.platform.memory import PlatformMemoryStore


def test_platform_resolves_api_key_roots_and_narrows_requests() -> None:
    store = PlatformMemoryStore()
    store.add_namespace_root("u1", "acme/team")
    allowed = resolve_allowed_roots(
        AuthContext(user_id="u1", auth_method="api_key", permissions=[]),
        store,
    )

    assert allowed.unbounded is False
    assert narrow_to_roots(allowed, ["acme/team/user"]) == ["acme/team/user"]
    with pytest.raises(NamespaceGrantError):
        narrow_to_roots(allowed, ["other/team"])


def test_platform_unbounded_internal_access_bypasses_roots() -> None:
    allowed = resolve_allowed_roots(
        AuthContext(
            user_id="admin",
            auth_method="internal",
            permissions=["namespace:unbounded"],
        ),
        PlatformMemoryStore(),
    )

    assert allowed.unbounded is True
    assert narrow_to_roots(allowed, ["any/scope"]) == ["any/scope"]
    assert assert_scope_within_roots(allowed, "other/scope") == "other/scope"


def test_platform_read_scopes_include_bounded_ancestors_only() -> None:
    store = PlatformMemoryStore()
    store.add_namespace_root("u1", "acme")
    allowed = resolve_allowed_roots(
        AuthContext(user_id="u1", auth_method="api_key", permissions=[]),
        store,
    )

    scopes, include_ancestors = read_scopes(allowed, ["acme/team/user"])

    assert scopes == ["acme", "acme/team", "acme/team/user"]
    assert include_ancestors is False


def test_platform_requires_registered_roots_for_bounded_callers() -> None:
    allowed = resolve_allowed_roots(
        AuthContext(user_id="u1", auth_method="api_key", permissions=[]),
        PlatformMemoryStore(),
    )

    with pytest.raises(ForbiddenError):
        narrow_to_roots(allowed, ["acme/team"])
