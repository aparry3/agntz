from __future__ import annotations

from typing import TypedDict, cast

import pytest

from agntz import NamespaceGrantError, normalize_namespace_grant, normalize_namespace_grants
from agntz.context import (
    namespace_ancestors,
    narrow_namespace_grants,
)
from agntz.memrez import (
    EntryType,
    MemrezScopeError,
    TaggerInput,
    TaggerResult,
    create_memrez,
)


class Directive(TypedDict):
    content: str
    scope: str | None
    topics: list[str] | None
    type: EntryType | None


class DirectiveReasoner:
    def tag(self, input_value: TaggerInput) -> TaggerResult:
        directive = _parse_directive(input_value.content)
        return TaggerResult(
            namespace=directive["scope"] or input_value.grants[0],
            topics=directive["topics"] or input_value.topics_hint or ["general"],
            type=directive["type"] or "fact",
            normalized_content=directive["content"],
        )


def test_namespace_grants_normalize_and_narrow() -> None:
    assert normalize_namespace_grants(["app/user/u_123", "app/user/u_123"]) == [
        "app/user/u_123"
    ]
    assert namespace_ancestors("app/user/u_123") == ["app", "app/user", "app/user/u_123"]
    assert narrow_namespace_grants(["app/user/u_123"], ["app/user/u_123/session/s_1"]) == [
        "app/user/u_123/session/s_1"
    ]

    with pytest.raises(NamespaceGrantError):
        normalize_namespace_grant(" app/user/u_123")
    with pytest.raises(NamespaceGrantError):
        narrow_namespace_grants(["app/user/u_123"], ["app/user/u_456"])


def test_memrez_reads_ancestors_without_sibling_leakage() -> None:
    memrez = create_memrez(reasoner=DirectiveReasoner())

    memrez.write(["app"], "scope:app|topic:shared|Global rule.")
    memrez.write(["app/user/u_123"], "topic:prefs|User 123 preference.")
    memrez.write(["app/user/u_456"], "topic:prefs|User 456 preference.")

    shared = memrez.read(["app/user/u_123"], "shared")
    prefs = memrez.read(["app/user/u_123"], "prefs")

    assert [entry.content for entry in shared] == ["Global rule."]
    assert [entry.content for entry in prefs] == ["User 123 preference."]


def test_memrez_write_scope_validation_matches_typescript_rules() -> None:
    memrez = create_memrez(reasoner=DirectiveReasoner())

    child = memrez.write(
        ["app/user/u_123"],
        "scope:app/user/u_123/session/s_1|topic:session|Session fact.",
    )
    assert child["entry"].scope == "app/user/u_123/session/s_1"

    with pytest.raises(MemrezScopeError):
        memrez.write(["app/user/u_123"], "scope:app/user/u_456|topic:prefs|Bad sibling.")

    promoted = memrez.write(
        ["sales/org/acme/account/a_789"],
        "scope:sales/org/acme|topic:rules|Generalized rule.",
        write_policy={"ancestorPromotion": "ancestors"},
    )
    assert promoted["entry"].scope == "sales/org/acme"


def _parse_directive(raw: str) -> Directive:
    parts = raw.split("|")
    out: Directive = {
        "content": parts[-1].strip(),
        "scope": None,
        "topics": None,
        "type": None,
    }
    for part in parts[:-1]:
        key, value = part.split(":", 1)
        if key == "scope":
            out["scope"] = value
        elif key == "topic":
            out["topics"] = [topic.strip() for topic in value.split(",")]
        elif key == "type":
            out["type"] = (
                cast(EntryType, value)
                if value in {"fact", "preference", "event", "summary"}
                else None
            )
    return out
