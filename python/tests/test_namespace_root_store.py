from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from agntz.context import NamespaceGrantError
from agntz.stores import MemoryStore, SQLiteStore

RootStore = MemoryStore | SQLiteStore


@pytest.fixture(params=["memory", "sqlite"])
def store(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[RootStore]:
    if request.param == "memory":
        yield MemoryStore()
        return
    yield SQLiteStore(tmp_path / "store.db")


def test_add_list_is_sorted_and_idempotent(store: RootStore) -> None:
    store.add_namespace_root("u1", "app/team")
    store.add_namespace_root("u1", "app/team")  # idempotent
    store.add_namespace_root("u1", "other/root")
    assert store.list_namespace_roots("u1") == ["app/team", "other/root"]


def test_roots_are_isolated_per_user(store: RootStore) -> None:
    store.add_namespace_root("u1", "app/team")
    store.add_namespace_root("u2", "globex")
    assert store.list_namespace_roots("u1") == ["app/team"]
    assert store.list_namespace_roots("u2") == ["globex"]


def test_remove_is_a_noop_when_absent(store: RootStore) -> None:
    store.add_namespace_root("u1", "app/team")
    store.remove_namespace_root("u1", "missing")
    store.remove_namespace_root("u1", "app/team")
    store.remove_namespace_root("u1", "app/team")
    assert store.list_namespace_roots("u1") == []


def test_invalid_root_rejected(store: RootStore) -> None:
    with pytest.raises(NamespaceGrantError):
        store.add_namespace_root("u1", "")


def test_malformed_root_rejected(store: RootStore) -> None:
    # grants must not start/end with '/' — normalize_namespace_grant validates on the way in
    with pytest.raises(NamespaceGrantError):
        store.add_namespace_root("u1", "app/team/")
    assert store.list_namespace_roots("u1") == []


def test_camel_case_aliases(store: RootStore) -> None:
    store.addNamespaceRoot("u1", "app/team")
    assert store.listNamespaceRoots("u1") == ["app/team"]
    store.removeNamespaceRoot("u1", "app/team")
    assert store.listNamespaceRoots("u1") == []
