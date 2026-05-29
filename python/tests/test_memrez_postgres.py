from __future__ import annotations

import os
from time import time_ns

import pytest

from agntz import PostgresMemoryStore, PostgresMemoryStoreOptions, create_memrez
from agntz.memrez import MemoryEntry

POSTGRES_URL = os.environ.get("MEMREZ_POSTGRES_URL") or os.environ.get("DATABASE_URL")

if POSTGRES_URL:
    pytest.importorskip("psycopg")

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="set MEMREZ_POSTGRES_URL or DATABASE_URL to run Postgres memrez tests",
)


def test_postgres_memory_store_persists_entries_and_scope_visibility() -> None:
    store = PostgresMemoryStore(
        PostgresMemoryStoreOptions(
            connection=POSTGRES_URL or "",
            table_prefix=f"test_{time_ns()}_",
        )
    )
    memrez = create_memrez(store=store)

    try:
        memrez.write(["app"], "Global policy.", topics_hint=["shared"])
        memrez.write(
            ["app/user/u_123"],
            "User 123 preference.",
            topics_hint=["prefs"],
            source={"agentId": "support", "runId": "run_1"},
        )
        memrez.write(["app/user/u_456"], "User 456 preference.", topics_hint=["prefs"])

        scan = memrez.scan(["app/user/u_123"])
        shared = memrez.read(["app/user/u_123"], "shared")
        prefs = memrez.read(["app/user/u_123"], "prefs")

        assert [(topic.topic, topic.count) for topic in scan["topics"]] == [
            ("prefs", 1),
            ("shared", 1),
        ]
        assert [entry.content for entry in shared] == ["Global policy."]
        assert len(prefs) == 1
        assert prefs[0].scope == "app/user/u_123"
        assert prefs[0].content == "User 123 preference."
        assert prefs[0].topics == ["prefs"]
        assert prefs[0].source == {"agentId": "support", "runId": "run_1"}
    finally:
        store.close()


def test_postgres_memory_store_persists_supersede_and_topic_meta() -> None:
    store = PostgresMemoryStore(
        PostgresMemoryStoreOptions(
            connection=POSTGRES_URL or "",
            table_prefix=f"test_{time_ns()}_",
        )
    )
    now = "2026-05-29T00:00:00.000Z"

    try:
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
    finally:
        store.close()
