from __future__ import annotations

from pathlib import Path

from agntz import DeterministicReasoner, SqliteMemoryStore, create_memrez
from agntz.memrez import MemoryEntry


def test_sqlite_memory_store_persists_entries(tmp_path: Path) -> None:
    db_path = tmp_path / "memrez.db"
    store = SqliteMemoryStore(db_path)
    memrez = create_memrez(store=store, reasoner=DeterministicReasoner())
    written = memrez.write(
        ["app/user/u_123"],
        "Prefers email receipts.",
        topics_hint=["prefs"],
        source={"agentId": "support", "runId": "run_1"},
    )
    store.close()

    reopened = SqliteMemoryStore(db_path)
    persisted = create_memrez(store=reopened, reasoner=DeterministicReasoner())
    entries = persisted.read(["app/user/u_123"], "prefs")

    assert len(entries) == 1
    assert entries[0].id == written["entry"].id
    assert entries[0].scope == "app/user/u_123"
    assert entries[0].content == "Prefers email receipts."
    assert entries[0].topics == ["prefs"]
    assert entries[0].source == {"agentId": "support", "runId": "run_1"}
    reopened.close()


def test_sqlite_memory_store_reads_ancestors_without_siblings(tmp_path: Path) -> None:
    store = SqliteMemoryStore(tmp_path / "memrez.db")
    memrez = create_memrez(store=store, reasoner=DeterministicReasoner())

    memrez.write(["app"], "Global policy.", topics_hint=["shared"])
    memrez.write(["app/user/u_123"], "User 123 preference.", topics_hint=["prefs"])
    memrez.write(["app/user/u_456"], "User 456 preference.", topics_hint=["prefs"])

    scan = memrez.scan(["app/user/u_123"])
    shared = memrez.read(["app/user/u_123"], "shared")
    prefs = memrez.read(["app/user/u_123"], "prefs")

    assert [(topic.topic, topic.count) for topic in scan["topics"]] == [
        ("prefs", 1),
        ("shared", 1),
    ]
    assert [entry.content for entry in shared] == ["Global policy."]
    assert [entry.content for entry in prefs] == ["User 123 preference."]
    store.close()


def test_sqlite_memory_store_persists_supersede_and_topic_meta(tmp_path: Path) -> None:
    store = SqliteMemoryStore(tmp_path / "memrez.db")
    now = "2026-05-29T00:00:00.000Z"

    store.put_entry(
        MemoryEntry(
            id="mem_a",
            scope="app/user/u_123",
            content="Likes SMS.",
            topics=["prefs"],
            type="preference",
            status="active",
            created_at=now,
            updated_at=now,
        )
    )
    store.put_entry(
        MemoryEntry(
            id="mem_b",
            scope="app/user/u_123",
            content="Prefers email.",
            topics=["prefs"],
            type="preference",
            status="active",
            created_at=now,
            updated_at=now,
        )
    )
    store.supersede(["mem_a"], "mem_b")
    store.set_topic_meta(
        "app/user/u_123",
        "prefs",
        blurb="Communication preferences.",
        last_updated_at="2026-05-27T00:00:00.000Z",
    )

    superseded = store.get_entry("mem_a")
    active_by_topic = store.get_by_topic(["app/user/u_123"], "prefs")
    all_prefs = store.list_scope_slice(
        ["app/user/u_123"],
        topics=["prefs"],
        include_superseded=True,
    )
    topics = store.list_topics(["app/user/u_123"])
    meta = store.get_topic_meta("app/user/u_123", "prefs")

    assert superseded is not None
    assert superseded.status == "superseded"
    assert superseded.superseded_by == "mem_b"
    assert [entry.id for entry in active_by_topic] == ["mem_b"]
    assert sorted(entry.id for entry in all_prefs) == ["mem_a", "mem_b"]
    assert topics[0].topic == "prefs"
    assert topics[0].count == 1
    assert topics[0].blurb == "Communication preferences."
    assert topics[0].last_updated_at == "2026-05-27T00:00:00.000Z"
    assert topics[0].has_uncurated_writes is True
    assert [(row.scope, row.topic) for row in store.list_dirty_topics()] == [
        ("app/user/u_123", "prefs")
    ]
    assert meta is not None
    assert meta.blurb == "Communication preferences."

    store.set_topic_meta(
        "app/user/u_123",
        "prefs",
        blurb="Communication preferences.",
        last_updated_at="2026-05-30T00:00:00.000Z",
    )
    assert store.list_topics(["app/user/u_123"])[0].has_uncurated_writes is False
    assert store.list_dirty_topics() == []
    store.close()
