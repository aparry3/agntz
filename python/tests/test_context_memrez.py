from __future__ import annotations

from typing import TypedDict, cast

import pytest

from agntz import (
    NamespaceGrantError,
    NamespaceGrantPolicy,
    ProtectedNamespaceRule,
    normalize_namespace_grant,
    normalize_namespace_grants,
)
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


class NoopCuratorReasoner(DirectiveReasoner):
    def __init__(self) -> None:
        self.curate_inputs: list[dict[str, object]] = []

    def curate(self, input_value: dict[str, object]) -> list[dict[str, object]]:
        self.curate_inputs.append(input_value)
        return []


def test_namespace_grants_normalize_and_narrow() -> None:
    assert normalize_namespace_grants(["app/user/u_123", "app/user/u_123"]) == ["app/user/u_123"]
    assert namespace_ancestors("app/user/u_123") == ["app", "app/user", "app/user/u_123"]
    assert narrow_namespace_grants(["app/user/u_123"], ["app/user/u_123/session/s_1"]) == [
        "app/user/u_123/session/s_1"
    ]

    with pytest.raises(NamespaceGrantError):
        normalize_namespace_grant(" app/user/u_123")
    with pytest.raises(NamespaceGrantError):
        narrow_namespace_grants(["app/user/u_123"], ["app/user/u_456"])


def test_namespace_security_policy_rejects_broad_protected_grants() -> None:
    policy = NamespaceGrantPolicy(
        protected_namespaces=[ProtectedNamespaceRule(namespace="gymtext/private/users")]
    )

    with pytest.raises(NamespaceGrantError):
        normalize_namespace_grants(["gymtext"], policy)
    with pytest.raises(NamespaceGrantError):
        normalize_namespace_grants(["gymtext/private/users"], policy)

    assert normalize_namespace_grants(["gymtext/private/users/u_123"], policy) == [
        "gymtext/private/users/u_123"
    ]
    assert normalize_namespace_grants(["gymtext/public/general"], policy) == [
        "gymtext/public/general"
    ]
    assert normalize_namespace_grants(
        ["gymtext/private/users"],
        {
            "protectedNamespaces": [
                {
                    "namespace": "gymtext/private/users",
                    "allowBoundaryGrant": True,
                }
            ]
        },
    ) == ["gymtext/private/users"]


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


def test_memrez_rejects_broad_protected_namespace_grants() -> None:
    memrez = create_memrez(
        reasoner=DirectiveReasoner(),
        namespace_policy={
            "protectedNamespaces": [{"namespace": "gymtext/private/users"}],
        },
    )

    with pytest.raises(NamespaceGrantError):
        memrez.write(["gymtext"], "topic:prefs|Bad broad root.")
    with pytest.raises(NamespaceGrantError):
        memrez.write(["gymtext/private/users"], "topic:prefs|Bad all-users grant.")

    result = memrez.write(
        ["gymtext/private/users/u_123"],
        "topic:prefs|User-specific memory.",
    )
    assert result["entry"].scope == "gymtext/private/users/u_123"


def test_memrez_multi_topic_read_list_and_correct() -> None:
    memrez = create_memrez(reasoner=DirectiveReasoner())
    first = memrez.write(
        ["app/user/u_123"],
        "topic:prefs,core|Prefers email.",
    )["entry"]
    memrez.write(["app/user/u_123"], "topic:goals|Train for a 10k.")

    multi_topic = memrez.read(["app/user/u_123"], ["prefs", "core"])
    assert [entry.id for entry in multi_topic] == [first.id]

    corrected = memrez.correct(["app/user/u_123"], first.id, "Prefers SMS.")
    all_entries = memrez.list(["app/user/u_123"], include_superseded=True)
    original = next(entry for entry in all_entries if entry.id == first.id)

    assert corrected["entry"].topics == ["prefs", "core"]
    assert corrected["entry"].type == first.type
    assert original.status == "superseded"
    assert original.superseded_by == corrected["entry"].id


def test_memrez_curate_stamps_dirty_topics_without_ops() -> None:
    reasoner = NoopCuratorReasoner()
    memrez = create_memrez(reasoner=reasoner)
    memrez.write(["app/user/u_123"], "topic:prefs,core|Prefers email.")

    assert {(row.scope, row.topic) for row in memrez.store.list_dirty_topics()} == {
        ("app/user/u_123", "core"),
        ("app/user/u_123", "prefs"),
    }
    assert memrez.scan(["app/user/u_123"])["topics"][0].has_uncurated_writes is True

    report = memrez.curate(["app/user/u_123"])

    assert report == {"scanned": 1, "superseded": 0, "created": 0, "blurbsUpdated": 0}
    assert memrez.store.list_dirty_topics() == []
    assert all(
        not topic.has_uncurated_writes
        for topic in memrez.scan(["app/user/u_123"])["topics"]
    )
    assert reasoner.curate_inputs[0]["topicConfig"] == {
        "core": "core",
        "preferred": [],
    }


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
