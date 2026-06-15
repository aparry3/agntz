from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from agntz import DeterministicReasoner, SqliteMemoryStore, create_memrez
from agntz.memrez import (
    InMemoryMemoryStore,
    MemoryStore,
    MemrezEntryNotFoundError,
    MemrezScopeError,
)


@pytest.fixture(params=["memory", "sqlite"])
def store(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[MemoryStore]:
    if request.param == "memory":
        yield InMemoryMemoryStore()
        return
    sqlite_store = SqliteMemoryStore(tmp_path / "memrez.db")
    try:
        yield sqlite_store
    finally:
        sqlite_store.close()


def _seed(store: MemoryStore) -> dict[str, str]:
    memrez = create_memrez(store=store, reasoner=DeterministicReasoner())
    alice = memrez.write(["app/team/alice"], "alice note", topics_hint=["notes"])
    child = memrez.write(["app/team/alice/child"], "nested note", topics_hint=["notes"])
    bob = memrez.write(["app/team/bob"], "bob note", topics_hint=["notes"])
    return {
        "alice": alice["entry"].id,
        "child": child["entry"].id,
        "bob": bob["entry"].id,
    }


def test_store_delete_entry_removes_row(store: MemoryStore) -> None:
    ids = _seed(store)
    assert store.delete_entry(ids["alice"]) is True
    assert store.get_entry(ids["alice"]) is None
    # second delete is a no-op (idempotent)
    assert store.delete_entry(ids["alice"]) is False
    # topic counts drop for the deleted scope
    assert store.list_topics(["app/team/alice"]) == []


def test_store_delete_scope_non_recursive_keeps_descendants(store: MemoryStore) -> None:
    _seed(store)
    result = store.delete_scope("app/team/alice")
    assert result["entries"] == 1
    remaining = {entry.scope for entry in store.list_entries()}
    assert remaining == {"app/team/alice/child", "app/team/bob"}


def test_store_delete_scope_recursive_removes_subtree(store: MemoryStore) -> None:
    _seed(store)
    result = store.delete_scope("app/team/alice", recursive=True)
    assert result["entries"] == 2
    remaining = {entry.scope for entry in store.list_entries()}
    assert remaining == {"app/team/bob"}


def test_store_delete_scope_removes_topic_meta(store: MemoryStore) -> None:
    _seed(store)
    store.set_topic_meta("app/team/alice", "notes", blurb="b")
    result = store.delete_scope("app/team/alice")
    assert result["topic_meta"] == 1
    assert store.get_topic_meta("app/team/alice", "notes") is None


def test_store_list_entries_includes_superseded(store: MemoryStore) -> None:
    memrez = create_memrez(store=store, reasoner=DeterministicReasoner())
    written = memrez.write(["app/team/alice"], "first", topics_hint=["notes"])
    memrez.correct(["app/team/alice"], written["entry"].id, "second")
    active = store.list_entries()
    assert [entry.content for entry in active] == ["second"]
    everything = store.list_entries(include_superseded=True)
    assert {entry.content for entry in everything} == {"first", "second"}


def test_sqlite_delete_cascades_entry_topics(tmp_path: Path) -> None:
    store = SqliteMemoryStore(tmp_path / "memrez.db")
    try:
        ids = _seed(store)
        store.delete_scope("app/team/alice", recursive=True)
        rows = store._conn.execute("SELECT COUNT(*) AS n FROM memrez_entry_topics").fetchone()
        # alice + child topic links are gone via FK cascade; only bob's remains
        assert rows["n"] == 1
        assert store.get_entry(ids["child"]) is None
    finally:
        store.close()


# --- Memrez-level grant authorization --------------------------------------------------------


def test_memrez_delete_entry_authorizes_owning_scope() -> None:
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    entry = memrez.write(["app/team/alice"], "note", topics_hint=["notes"])["entry"]
    result = memrez.delete_entry(["app/team"], entry.id)  # ancestor grant covers descendant
    assert result == {"deleted": True, "id": entry.id}
    assert memrez.store.get_entry(entry.id) is None


def test_memrez_delete_entry_missing_raises() -> None:
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    with pytest.raises(MemrezEntryNotFoundError):
        memrez.delete_entry(["app/team"], "mem_missing")


def test_memrez_delete_entry_blocks_foreign_scope() -> None:
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    entry = memrez.write(["app/team/alice"], "note", topics_hint=["notes"])["entry"]
    with pytest.raises(MemrezScopeError):
        memrez.delete_entry(["app/other"], entry.id)
    assert memrez.store.get_entry(entry.id) is not None


def test_memrez_delete_scope_blocks_sibling() -> None:
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    memrez.write(["app/team/alice"], "note", topics_hint=["notes"])
    with pytest.raises(MemrezScopeError):
        memrez.delete_scope(["app/team/bob"], "app/team/alice")


def test_memrez_delete_scope_returns_camel_case_shape() -> None:
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    memrez.write(["app/team/alice"], "note", topics_hint=["notes"])
    memrez.write(["app/team/alice/child"], "nested", topics_hint=["notes"])
    result = memrez.delete_scope(["app/team"], "app/team/alice", recursive=True)
    assert result == {"deleted": 2, "topicMeta": 0, "scope": "app/team/alice", "recursive": True}


def test_provider_purge_scope_deletes_subtree() -> None:
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    memrez.write(["app/team/alice"], "note", topics_hint=["notes"])
    memrez.write(["app/team/alice/child"], "nested", topics_hint=["notes"])
    provider = memrez.provider()
    assert provider.purge_scope("app/team/alice") == {"deleted": 2}
    assert memrez.store.list_entries() == []
