"""SQLite-backed local run store."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .memory import LocalRunRecord


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


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _loads(value: str | None) -> Any:
    if value is None:
        return None
    return json.loads(value)
