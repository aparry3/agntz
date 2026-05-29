from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from agntz import NamespaceGrantError, normalize_namespace_grants
from agntz.memrez import (
    MemrezScopeError,
    assert_writable_scope,
    create_memrez,
    normalize_write_policy,
    visible_scopes,
)

ROOT = Path(__file__).resolve().parents[3]
CONTRACT = ROOT / "contracts" / "memrez" / "phase1.json"


def _contract() -> dict[str, Any]:
    return json.loads(CONTRACT.read_text(encoding="utf-8"))


def test_memrez_grant_semantics_contract() -> None:
    semantics = _contract()["grantSemantics"]
    grant = semantics["grant"]

    assert visible_scopes([grant]) == semantics["readableScopes"]
    for scope in semantics["notReadableScopes"]:
        assert scope not in visible_scopes([grant])
    assert assert_writable_scope([grant], grant, normalize_write_policy(None)) == grant
    assert (
        assert_writable_scope(
            [grant],
            f"{grant}/session/s_1",
            normalize_write_policy(None),
        )
        == f"{grant}/session/s_1"
    )
    for scope in semantics["notWritableScopes"]:
        with pytest.raises(MemrezScopeError):
            assert_writable_scope([grant], scope, normalize_write_policy(None))


def test_memrez_namespace_security_contract() -> None:
    security = _contract()["namespaceSecurity"]
    for rule in security["protectedNamespaces"]:
        policy = {"protectedNamespaces": [{"namespace": rule["namespace"]}]}
        for grant in rule["rejectedGrants"]:
            with pytest.raises(NamespaceGrantError):
                normalize_namespace_grants([grant], policy)
        assert normalize_namespace_grants([rule["allowedGrant"]], policy) == [rule["allowedGrant"]]
        assert normalize_namespace_grants([rule["unaffectedGrant"]], policy) == [
            rule["unaffectedGrant"]
        ]


def test_memrez_contract_scenarios() -> None:
    contract = _contract()
    scenarios = {scenario["name"]: scenario for scenario in contract["scenarios"]}

    read_scenario = scenarios["ancestor-read-without-sibling-leakage"]
    memrez = create_memrez()
    for write in read_scenario["writes"]:
        memrez.write(
            write["grants"],
            write["content"],
            topics_hint=write["topicsHint"],
        )
    for read in read_scenario["reads"]:
        entries = memrez.read(read["grants"], read["topic"])
        assert [entry.content for entry in entries] == read["contents"]
    scan = memrez.scan(read_scenario["scan"]["grants"])
    assert [(topic.topic, topic.count) for topic in scan["topics"]] == [
        tuple(topic) for topic in read_scenario["scan"]["topics"]
    ]

    rejected = scenarios["write-sibling-rejected"]
    with pytest.raises(MemrezScopeError):
        assert_writable_scope(
            rejected["grants"],
            rejected["target"],
            normalize_write_policy(rejected.get("writePolicy")),
        )

    promoted = scenarios["ancestor-promotion-allows-exact-ancestor"]
    assert (
        assert_writable_scope(
            promoted["grants"],
            promoted["target"],
            normalize_write_policy(promoted["writePolicy"]),
        )
        == promoted["target"]
    )
