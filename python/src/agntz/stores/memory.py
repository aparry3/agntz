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


@dataclass(frozen=True)
class LocalTraceRecord:
    trace_id: str
    run_id: str
    agent_id: str
    session_id: str
    status: str
    started_at: float
    ended_at: float | None = None
    output: Any = None
    error: str | None = None

    def summary(self) -> dict[str, Any]:
        duration_ms = None
        if self.ended_at is not None:
            duration_ms = int((self.ended_at - self.started_at) * 1000)
        return {
            "traceId": self.trace_id,
            "ownerId": "local",
            "rootName": self.agent_id,
            "agentId": self.agent_id,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "durationMs": duration_ms,
            "spanCount": 1,
            "status": self.status,
            "totalTokens": 0,
            "totalCostUsd": None,
        }


class RunStore(Protocol):
    def put_run(self, run: LocalRunRecord) -> None: ...

    def get_run(self, run_id: str) -> LocalRunRecord | None: ...

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]: ...

    def put_trace(self, trace: LocalTraceRecord) -> None: ...

    def get_trace(self, trace_id: str) -> LocalTraceRecord | None: ...

    def list_traces(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalTraceRecord]: ...


class MemoryStore:
    def __init__(self) -> None:
        self._runs: dict[str, LocalRunRecord] = {}
        self._traces: dict[str, LocalTraceRecord] = {}

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

    def put_trace(self, trace: LocalTraceRecord) -> None:
        self._traces[trace.trace_id] = trace

    def get_trace(self, trace_id: str) -> LocalTraceRecord | None:
        return self._traces.get(trace_id)

    def list_traces(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalTraceRecord]:
        rows = list(self._traces.values())
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return rows
