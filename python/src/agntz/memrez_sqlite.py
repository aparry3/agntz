"""SQLite-backed memrez memory store."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

from .memrez import EntryType, MemoryEntry, Source, TopicSummary


@dataclass(frozen=True)
class SqliteMemoryStoreOptions:
    path: str | Path
    wal: bool = True


class SqliteMemoryStore:
    def __init__(self, options: str | Path | SqliteMemoryStoreOptions) -> None:
        opts = (
            SqliteMemoryStoreOptions(path=options)
            if isinstance(options, str | Path)
            else options
        )
        self.path = str(opts.path)
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA busy_timeout = 5000")
        journal_mode = "PRAGMA journal_mode = WAL" if opts.wal else "PRAGMA journal_mode = DELETE"
        self._conn.execute(journal_mode)
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._migrate()

    def close(self) -> None:
        self._conn.close()

    def put_entry(self, entry: MemoryEntry) -> None:
        topics = list(dict.fromkeys(entry.topics))
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO memrez_entries (
                  id, scope, content, type, source, status, superseded_by,
                  created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  scope = excluded.scope,
                  content = excluded.content,
                  type = excluded.type,
                  source = excluded.source,
                  status = excluded.status,
                  superseded_by = excluded.superseded_by,
                  created_at = excluded.created_at,
                  updated_at = excluded.updated_at
                """,
                (
                    entry.id,
                    entry.scope,
                    entry.content,
                    entry.type,
                    json.dumps(entry.source) if entry.source is not None else None,
                    entry.status,
                    entry.superseded_by,
                    entry.created_at,
                    entry.updated_at,
                ),
            )
            self._conn.execute(
                "DELETE FROM memrez_entry_topics WHERE entry_id = ?",
                (entry.id,),
            )
            self._conn.executemany(
                "INSERT OR IGNORE INTO memrez_entry_topics (entry_id, topic) VALUES (?, ?)",
                [(entry.id, topic) for topic in topics],
            )

    def get_entry(self, entry_id: str) -> MemoryEntry | None:
        row = self._conn.execute(
            "SELECT * FROM memrez_entries WHERE id = ?",
            (entry_id,),
        ).fetchone()
        return self._row_to_entry(row) if row is not None else None

    def supersede(self, ids: Sequence[str], by_id: str) -> None:
        if not ids:
            return
        now = _now_iso()
        with self._conn:
            self._conn.executemany(
                """
                UPDATE memrez_entries
                SET status = 'superseded', superseded_by = ?, updated_at = ?
                WHERE id = ?
                """,
                [(by_id, now, entry_id) for entry_id in ids],
            )

    def list_topics(self, scope_paths: Sequence[str]) -> list[TopicSummary]:
        if not scope_paths:
            return []
        rows = self._conn.execute(
            f"""
            SELECT t.topic AS topic, COUNT(*) AS count, MAX(e.updated_at) AS last_updated_at
            FROM memrez_entries e
            JOIN memrez_entry_topics t ON t.entry_id = e.id
            WHERE e.status = 'active' AND e.scope IN ({_placeholders(scope_paths)})
            GROUP BY t.topic
            ORDER BY t.topic ASC
            """,
            tuple(scope_paths),
        ).fetchall()
        summaries: list[TopicSummary] = []
        for row in rows:
            topic = str(row["topic"])
            meta = self._find_topic_meta(scope_paths, topic)
            summaries.append(
                TopicSummary(
                    topic=topic,
                    count=int(row["count"]),
                    blurb=meta["blurb"] if meta is not None else None,
                    last_updated_at=(
                        str(meta["last_updated_at"])
                        if meta is not None and meta["last_updated_at"] is not None
                        else str(row["last_updated_at"])
                    ),
                    has_uncurated_writes=True,
                )
            )
        return summaries

    def get_by_topic(
        self,
        scope_paths: Sequence[str],
        topic: str,
        limit: int | None = None,
    ) -> list[MemoryEntry]:
        if not scope_paths:
            return []
        params: list[Any] = [*scope_paths, topic]
        limit_clause = ""
        if limit is not None:
            limit_clause = "LIMIT ?"
            params.append(limit)
        rows = self._conn.execute(
            f"""
            SELECT e.*
            FROM memrez_entries e
            JOIN memrez_entry_topics t ON t.entry_id = e.id
            WHERE e.status = 'active'
              AND e.scope IN ({_placeholders(scope_paths)})
              AND t.topic = ?
            ORDER BY e.updated_at DESC
            {limit_clause}
            """,
            tuple(params),
        ).fetchall()
        return [self._row_to_entry(row) for row in rows]

    def set_topic_meta(
        self,
        scope: str,
        topic: str,
        *,
        blurb: str | None = None,
        last_updated_at: str | None = None,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO memrez_topic_meta (scope, topic, blurb, last_updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(scope, topic) DO UPDATE SET
              blurb = excluded.blurb,
              last_updated_at = excluded.last_updated_at
            """,
            (scope, topic, blurb, last_updated_at or _now_iso()),
        )
        self._conn.commit()

    def list_scope_slice(
        self,
        scope_paths: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
    ) -> list[MemoryEntry]:
        if not scope_paths:
            return []
        joins = ""
        clauses = [f"e.scope IN ({_placeholders(scope_paths)})"]
        params: list[Any] = [*scope_paths]
        if not include_superseded:
            clauses.append("e.status = 'active'")
        if topics:
            joins = "JOIN memrez_entry_topics t ON t.entry_id = e.id"
            clauses.append(f"t.topic IN ({_placeholders(topics)})")
            params.extend(topics)
        rows = self._conn.execute(
            f"""
            SELECT DISTINCT e.*
            FROM memrez_entries e
            {joins}
            WHERE {' AND '.join(clauses)}
            ORDER BY e.updated_at DESC
            """,
            tuple(params),
        ).fetchall()
        return [self._row_to_entry(row) for row in rows]

    def _migrate(self) -> None:
        self._conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS memrez_entries (
              id            TEXT PRIMARY KEY,
              scope         TEXT NOT NULL,
              content       TEXT NOT NULL,
              type          TEXT NOT NULL,
              source        TEXT,
              status        TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
              superseded_by TEXT,
              created_at    TEXT NOT NULL,
              updated_at    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_memrez_entries_scope_status_updated
              ON memrez_entries(scope, status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_memrez_entries_updated
              ON memrez_entries(updated_at DESC);

            CREATE TABLE IF NOT EXISTS memrez_entry_topics (
              entry_id TEXT NOT NULL,
              topic    TEXT NOT NULL,
              PRIMARY KEY (entry_id, topic),
              FOREIGN KEY (entry_id) REFERENCES memrez_entries(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_memrez_entry_topics_topic
              ON memrez_entry_topics(topic, entry_id);

            CREATE TABLE IF NOT EXISTS memrez_topic_meta (
              scope           TEXT NOT NULL,
              topic           TEXT NOT NULL,
              blurb           TEXT,
              last_updated_at TEXT NOT NULL,
              PRIMARY KEY (scope, topic)
            );

            CREATE TABLE IF NOT EXISTS memrez_schema_version (
              version INTEGER PRIMARY KEY
            );
            INSERT OR IGNORE INTO memrez_schema_version (version) VALUES (1);
            """
        )
        self._conn.commit()

    def _row_to_entry(self, row: sqlite3.Row) -> MemoryEntry:
        raw_source = row["source"]
        source = _parse_source(raw_source) if raw_source is not None else None
        return MemoryEntry(
            id=str(row["id"]),
            scope=str(row["scope"]),
            content=str(row["content"]),
            topics=self._topics_for_entry(str(row["id"])),
            type=_entry_type(str(row["type"])),
            source=source,
            status=_entry_status(str(row["status"])),
            superseded_by=(
                str(row["superseded_by"]) if row["superseded_by"] is not None else None
            ),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def _topics_for_entry(self, entry_id: str) -> list[str]:
        rows = self._conn.execute(
            "SELECT topic FROM memrez_entry_topics WHERE entry_id = ? ORDER BY topic ASC",
            (entry_id,),
        ).fetchall()
        return [str(row["topic"]) for row in rows]

    def _find_topic_meta(
        self,
        scope_paths: Sequence[str],
        topic: str,
    ) -> sqlite3.Row | None:
        for scope in reversed(scope_paths):
            row = self._conn.execute(
                """
                SELECT topic, blurb, last_updated_at
                FROM memrez_topic_meta
                WHERE scope = ? AND topic = ?
                """,
                (scope, topic),
            ).fetchone()
            if row is not None:
                return row
        return None


def _placeholders(values: Sequence[Any]) -> str:
    return ",".join("?" for _ in values)


def _parse_source(raw: str) -> Source:
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        return {}
    return cast(Source, {str(key): str(value) for key, value in parsed.items()})


def _entry_type(value: str) -> EntryType:
    if value in {"fact", "preference", "event", "summary"}:
        return cast(EntryType, value)
    return "fact"


def _entry_status(value: str) -> Literal["active", "superseded"]:
    if value == "superseded":
        return "superseded"
    return "active"


def _now_iso() -> str:
    from datetime import UTC, datetime

    return datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
