"""SQLite-backed local run store."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .memory import (
    LocalMessageRecord,
    LocalRunRecord,
    LocalSessionSummary,
    LocalTraceRecord,
)


class SQLiteStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    def close(self) -> None:
        self._conn.close()

    def put_run(self, run: LocalRunRecord) -> None:
        self._conn.execute(
            """
            INSERT INTO runs (
              id, root_id, agent_id, session_id, status, input_json, output_json, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              root_id=excluded.root_id,
              agent_id=excluded.agent_id,
              session_id=excluded.session_id,
              status=excluded.status,
              input_json=excluded.input_json,
              output_json=excluded.output_json,
              error=excluded.error
            """,
            (
                run.id,
                run.root_id,
                run.agent_id,
                run.session_id,
                run.status,
                _dumps(run.input),
                _dumps(run.output),
                run.error,
            ),
        )
        self._conn.commit()

    def get_run(self, run_id: str) -> LocalRunRecord | None:
        row = self._conn.execute(
            "SELECT * FROM runs WHERE id = ?",
            (run_id,),
        ).fetchone()
        return _row_to_run(row) if row is not None else None

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]:
        query = "SELECT * FROM runs"
        clauses: list[str] = []
        params: list[str] = []
        if agent_id is not None:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY rowid ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [_row_to_run(row) for row in rows]

    def put_trace(self, trace: LocalTraceRecord) -> None:
        self._conn.execute(
            """
            INSERT INTO traces (
              trace_id, run_id, agent_id, session_id, status,
              started_at, ended_at, output_json, error
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(trace_id) DO UPDATE SET
              run_id=excluded.run_id,
              agent_id=excluded.agent_id,
              session_id=excluded.session_id,
              status=excluded.status,
              started_at=excluded.started_at,
              ended_at=excluded.ended_at,
              output_json=excluded.output_json,
              error=excluded.error
            """,
            (
                trace.trace_id,
                trace.run_id,
                trace.agent_id,
                trace.session_id,
                trace.status,
                trace.started_at,
                trace.ended_at,
                _dumps(trace.output),
                trace.error,
            ),
        )
        self._conn.commit()

    def get_trace(self, trace_id: str) -> LocalTraceRecord | None:
        row = self._conn.execute(
            "SELECT * FROM traces WHERE trace_id = ?",
            (trace_id,),
        ).fetchone()
        return _row_to_trace(row) if row is not None else None

    def list_traces(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalTraceRecord]:
        query = "SELECT * FROM traces"
        clauses: list[str] = []
        params: list[str] = []
        if agent_id is not None:
            clauses.append("agent_id = ?")
            params.append(agent_id)
        if status is not None:
            clauses.append("status = ?")
            params.append(status)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY rowid ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [_row_to_trace(row) for row in rows]

    def append_messages(
        self,
        session_id: str,
        messages: list[LocalMessageRecord],
        *,
        agent_id: str | None = None,
    ) -> None:
        if not messages:
            return
        existing = self._conn.execute(
            "SELECT created_at, agent_id FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        created_at = existing["created_at"] if existing is not None else messages[0].timestamp
        session_agent_id = agent_id or (existing["agent_id"] if existing is not None else None)
        updated_at = messages[-1].timestamp
        with self._conn:
            self._conn.execute(
                """
                INSERT INTO sessions (id, agent_id, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  agent_id=COALESCE(excluded.agent_id, sessions.agent_id),
                  updated_at=excluded.updated_at
                """,
                (session_id, session_agent_id, created_at, updated_at),
            )
            self._conn.executemany(
                """
                INSERT INTO messages (
                  session_id, agent_id, role, content_json,
                  tool_calls_json, tool_call_id, timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        message.session_id,
                        message.agent_id,
                        message.role,
                        _dumps(message.content),
                        _dumps(message.tool_calls),
                        message.tool_call_id,
                        message.timestamp,
                    )
                    for message in messages
                ],
            )

    def get_messages(self, session_id: str) -> list[LocalMessageRecord]:
        rows = self._conn.execute(
            """
            SELECT session_id, agent_id, role, content_json,
                   tool_calls_json, tool_call_id, timestamp
            FROM messages
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        ).fetchall()
        return [_row_to_message(row) for row in rows]

    def list_sessions(
        self,
        *,
        agent_id: str | None = None,
    ) -> list[LocalSessionSummary]:
        query = """
            SELECT s.id, s.agent_id, s.created_at, s.updated_at, COUNT(m.id) AS message_count
            FROM sessions s
            LEFT JOIN messages m ON m.session_id = s.id
        """
        clauses: list[str] = []
        params: list[str] = []
        if agent_id is not None:
            clauses.append("s.agent_id = ?")
            params.append(agent_id)
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " GROUP BY s.id ORDER BY s.updated_at DESC"
        rows = self._conn.execute(query, params).fetchall()
        return [_row_to_session(row) for row in rows]

    def delete_session(self, session_id: str) -> None:
        with self._conn:
            self._conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
            self._conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def _migrate(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
              id TEXT PRIMARY KEY,
              root_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              status TEXT NOT NULL,
              input_json TEXT,
              output_json TEXT,
              error TEXT
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS traces (
              trace_id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at REAL NOT NULL,
              ended_at REAL,
              output_json TEXT,
              error TEXT
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY,
              agent_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              agent_id TEXT,
              role TEXT NOT NULL,
              content_json TEXT NOT NULL,
              tool_calls_json TEXT,
              tool_call_id TEXT,
              timestamp TEXT NOT NULL
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)"
        )
        self._conn.commit()


def _row_to_run(row: sqlite3.Row) -> LocalRunRecord:
    return LocalRunRecord(
        id=row["id"],
        root_id=row["root_id"],
        agent_id=row["agent_id"],
        session_id=row["session_id"],
        status=row["status"],
        input=_loads(row["input_json"]),
        output=_loads(row["output_json"]),
        error=row["error"],
    )


def _row_to_trace(row: sqlite3.Row) -> LocalTraceRecord:
    return LocalTraceRecord(
        trace_id=row["trace_id"],
        run_id=row["run_id"],
        agent_id=row["agent_id"],
        session_id=row["session_id"],
        status=row["status"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        output=_loads(row["output_json"]),
        error=row["error"],
    )


def _row_to_message(row: sqlite3.Row) -> LocalMessageRecord:
    return LocalMessageRecord(
        session_id=row["session_id"],
        agent_id=row["agent_id"],
        role=row["role"],
        content=_loads(row["content_json"]),
        tool_calls=_loads(row["tool_calls_json"]),
        tool_call_id=row["tool_call_id"],
        timestamp=row["timestamp"],
    )


def _row_to_session(row: sqlite3.Row) -> LocalSessionSummary:
    return LocalSessionSummary(
        session_id=row["id"],
        agent_id=row["agent_id"],
        message_count=int(row["message_count"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _loads(value: str | None) -> Any:
    if value is None:
        return None
    return json.loads(value)
