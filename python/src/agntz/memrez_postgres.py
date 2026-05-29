"""Postgres-backed memrez memory store."""

from __future__ import annotations

import importlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

from .memrez import EntryType, MemoryEntry, Source, TopicSummary

_IDENTIFIER_PREFIX_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


@dataclass(frozen=True)
class PostgresMemoryStoreOptions:
    connection: str
    table_prefix: str = ""
    run_migrations: bool = True


class PostgresMemoryStore:
    def __init__(self, options: str | PostgresMemoryStoreOptions) -> None:
        opts = (
            PostgresMemoryStoreOptions(connection=options)
            if isinstance(options, str)
            else options
        )
        self.prefix = _normalize_table_prefix(opts.table_prefix)
        self._psycopg = _load_psycopg()
        rows = importlib.import_module("psycopg.rows")
        self._jsonb = importlib.import_module("psycopg.types.json").Jsonb
        self._conn = self._psycopg.connect(
            opts.connection,
            autocommit=True,
            row_factory=rows.dict_row,
        )
        if opts.run_migrations:
            self._migrate()

    def close(self) -> None:
        self._conn.close()

    def put_entry(self, entry: MemoryEntry) -> None:
        topics = list(dict.fromkeys(entry.topics))
        with self._conn.transaction():
            self._conn.execute(
                f"""
                INSERT INTO {self._table("entries")} (
                  id, scope, content, type, source, status, superseded_by,
                  created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    self._jsonb(entry.source) if entry.source is not None else None,
                    entry.status,
                    entry.superseded_by,
                    entry.created_at,
                    entry.updated_at,
                ),
            )
            self._conn.execute(
                f"DELETE FROM {self._table('entry_topics')} WHERE entry_id = %s",
                (entry.id,),
            )
            for topic in topics:
                self._conn.execute(
                    f"""
                    INSERT INTO {self._table("entry_topics")} (entry_id, topic)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (entry.id, topic),
                )

    def get_entry(self, entry_id: str) -> MemoryEntry | None:
        row = self._conn.execute(
            f"SELECT * FROM {self._table('entries')} WHERE id = %s",
            (entry_id,),
        ).fetchone()
        return self._row_to_entry(row) if row is not None else None

    def supersede(self, ids: Sequence[str], by_id: str) -> None:
        if not ids:
            return
        self._conn.execute(
            f"""
            UPDATE {self._table("entries")}
            SET status = 'superseded', superseded_by = %s, updated_at = %s
            WHERE id = ANY(%s::text[])
            """,
            (by_id, _now_iso(), list(ids)),
        )

    def list_topics(self, scope_paths: Sequence[str]) -> list[TopicSummary]:
        if not scope_paths:
            return []
        rows = self._conn.execute(
            f"""
            SELECT t.topic AS topic, COUNT(*) AS count, MAX(e.updated_at) AS last_updated_at
            FROM {self._table("entries")} e
            JOIN {self._table("entry_topics")} t ON t.entry_id = e.id
            WHERE e.status = 'active' AND e.scope = ANY(%s::text[])
            GROUP BY t.topic
            ORDER BY t.topic ASC
            """,
            (list(scope_paths),),
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
        params: list[Any] = [list(scope_paths), topic]
        limit_clause = ""
        if limit is not None:
            limit_clause = "LIMIT %s"
            params.append(limit)
        rows = self._conn.execute(
            f"""
            SELECT e.*
            FROM {self._table("entries")} e
            JOIN {self._table("entry_topics")} t ON t.entry_id = e.id
            WHERE e.status = 'active'
              AND e.scope = ANY(%s::text[])
              AND t.topic = %s
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
            f"""
            INSERT INTO {self._table("topic_meta")} (scope, topic, blurb, last_updated_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(scope, topic) DO UPDATE SET
              blurb = excluded.blurb,
              last_updated_at = excluded.last_updated_at
            """,
            (scope, topic, blurb, last_updated_at or _now_iso()),
        )

    def list_scope_slice(
        self,
        scope_paths: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
    ) -> list[MemoryEntry]:
        if not scope_paths:
            return []
        clauses = ["e.scope = ANY(%s::text[])"]
        params: list[Any] = [list(scope_paths)]
        if not include_superseded:
            clauses.append("e.status = 'active'")
        if topics:
            clauses.append(
                f"""
                EXISTS (
                  SELECT 1 FROM {self._table("entry_topics")} t
                  WHERE t.entry_id = e.id AND t.topic = ANY(%s::text[])
                )
                """
            )
            params.append(list(topics))
        rows = self._conn.execute(
            f"""
            SELECT e.*
            FROM {self._table("entries")} e
            WHERE {" AND ".join(clauses)}
            ORDER BY e.updated_at DESC
            """,
            tuple(params),
        ).fetchall()
        return [self._row_to_entry(row) for row in rows]

    def _migrate(self) -> None:
        self._conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("entries")} (
              id            TEXT PRIMARY KEY,
              scope         TEXT NOT NULL,
              content       TEXT NOT NULL,
              type          TEXT NOT NULL,
              source        JSONB,
              status        TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
              superseded_by TEXT,
              created_at    TEXT NOT NULL,
              updated_at    TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {self._index("entries_scope_status_updated")}
              ON {self._table("entries")}(scope, status, updated_at DESC)
            """
        )
        self._conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {self._index("entries_updated")}
              ON {self._table("entries")}(updated_at DESC)
            """
        )
        self._conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("entry_topics")} (
              entry_id TEXT NOT NULL REFERENCES {self._table("entries")}(id) ON DELETE CASCADE,
              topic    TEXT NOT NULL,
              PRIMARY KEY (entry_id, topic)
            )
            """
        )
        self._conn.execute(
            f"""
            CREATE INDEX IF NOT EXISTS {self._index("entry_topics_topic")}
              ON {self._table("entry_topics")}(topic, entry_id)
            """
        )
        self._conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("topic_meta")} (
              scope           TEXT NOT NULL,
              topic           TEXT NOT NULL,
              blurb           TEXT,
              last_updated_at TEXT NOT NULL,
              PRIMARY KEY (scope, topic)
            )
            """
        )
        self._conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("schema_version")} (
              version INTEGER PRIMARY KEY
            )
            """
        )
        self._conn.execute(
            f"""
            INSERT INTO {self._table("schema_version")} (version)
            VALUES (1)
            ON CONFLICT DO NOTHING
            """
        )

    def _row_to_entry(self, row: dict[str, Any]) -> MemoryEntry:
        return MemoryEntry(
            id=str(row["id"]),
            scope=str(row["scope"]),
            content=str(row["content"]),
            topics=self._topics_for_entry(str(row["id"])),
            type=_entry_type(str(row["type"])),
            source=_parse_source(row["source"]),
            status=_entry_status(str(row["status"])),
            superseded_by=(
                str(row["superseded_by"]) if row["superseded_by"] is not None else None
            ),
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )

    def _topics_for_entry(self, entry_id: str) -> list[str]:
        rows = self._conn.execute(
            f"""
            SELECT topic FROM {self._table("entry_topics")}
            WHERE entry_id = %s
            ORDER BY topic ASC
            """,
            (entry_id,),
        ).fetchall()
        return [str(row["topic"]) for row in rows]

    def _find_topic_meta(
        self,
        scope_paths: Sequence[str],
        topic: str,
    ) -> dict[str, Any] | None:
        row = self._conn.execute(
            f"""
            SELECT blurb, last_updated_at
            FROM {self._table("topic_meta")}
            WHERE scope = ANY(%s::text[]) AND topic = %s
            ORDER BY array_position(%s::text[], scope) DESC
            LIMIT 1
            """,
            (list(scope_paths), topic, list(scope_paths)),
        ).fetchone()
        return dict(row) if row is not None else None

    def _table(self, name: str) -> str:
        return _quote_identifier(f"{self.prefix}memrez_{name}")

    def _index(self, name: str) -> str:
        return _quote_identifier(f"{self.prefix}idx_memrez_{name}")


def _load_psycopg() -> Any:
    try:
        return importlib.import_module("psycopg")
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "PostgresMemoryStore requires psycopg. Install agntz[postgres] "
            "or psycopg[binary]>=3.2.0."
        ) from exc


def _normalize_table_prefix(prefix: str) -> str:
    if not prefix:
        return ""
    if _IDENTIFIER_PREFIX_RE.fullmatch(prefix) is None:
        raise ValueError("PostgresMemoryStore table_prefix must be a valid identifier prefix")
    return prefix


def _quote_identifier(identifier: str) -> str:
    escaped = identifier.replace('"', '""')
    return f'"{escaped}"'


def _parse_source(raw: Any) -> Source | None:
    if raw is None:
        return None
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(parsed, dict):
        return None
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
