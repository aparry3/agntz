"""In-memory records used by the embedded local SDK."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class LocalRunRecord:
    id: str
    root_id: str
    agent_id: str
    session_id: str
    status: str
    input: Any
    output: Any = None
    error: str | None = None


class RunStore(Protocol):
    def put_run(self, run: LocalRunRecord) -> None: ...

    def get_run(self, run_id: str) -> LocalRunRecord | None: ...

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]: ...


class MemoryStore:
    def __init__(self) -> None:
        self._runs: dict[str, LocalRunRecord] = {}

    def put_run(self, run: LocalRunRecord) -> None:
        self._runs[run.id] = run

    def get_run(self, run_id: str) -> LocalRunRecord | None:
        return self._runs.get(run_id)

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]:
        rows = list(self._runs.values())
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return rows
