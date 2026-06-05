"""In-memory records used by the embedded local SDK."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from agntz.client.models import (
    AgentDefinition,
    AgentVersionSummary,
    ApiKeyRecord,
    EvalDataset,
    EvalDefinition,
    EvalLatestScore,
    EvalRun,
    EvalRunListResult,
)
from agntz.evals import list_eval_runs_in_process

DEFAULT_USER_ID = "__default__"


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

    def summary(
        self,
        *,
        span_count: int = 1,
        total_tokens: int = 0,
        total_cost_usd: float | None = None,
    ) -> dict[str, Any]:
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
            "spanCount": span_count,
            "status": self.status,
            "totalTokens": total_tokens,
            "totalCostUsd": total_cost_usd,
        }


@dataclass(frozen=True)
class LocalTraceSpanRecord:
    span_id: str
    trace_id: str
    parent_id: str | None
    name: str
    kind: str
    started_at: float
    ended_at: float | None
    status: str
    run_id: str | None = None
    session_id: str | None = None
    error: str | None = None
    attributes: dict[str, Any] | None = None
    events: list[dict[str, Any]] | None = None
    scores: dict[str, Any] | None = None
    cost_usd: float | None = None

    def as_dict(self) -> dict[str, Any]:
        duration_ms = None
        if self.ended_at is not None:
            duration_ms = int((self.ended_at - self.started_at) * 1000)
        return {
            "spanId": self.span_id,
            "traceId": self.trace_id,
            "parentId": self.parent_id,
            "ownerId": "local",
            "runId": self.run_id,
            "sessionId": self.session_id,
            "name": self.name,
            "kind": self.kind,
            "startedAt": self.started_at,
            "endedAt": self.ended_at,
            "durationMs": duration_ms,
            "status": self.status,
            "error": self.error,
            "attributes": self.attributes or {},
            "events": self.events or [],
            "scores": self.scores or {},
            "costUsd": self.cost_usd,
        }


@dataclass(frozen=True)
class LocalMessageRecord:
    session_id: str
    role: str
    content: str | list[dict[str, Any]]
    timestamp: str
    agent_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None


@dataclass(frozen=True)
class LocalSessionSummary:
    session_id: str
    message_count: int
    created_at: str
    updated_at: str
    agent_id: str | None = None


@dataclass
class _AgentVersion:
    agent: AgentDefinition
    created_at: str
    activated_at: str | None


@dataclass
class _ApiKeyRow:
    id: str
    user_id: str
    name: str
    key_prefix: str
    key_hash: str
    created_at: str
    last_used_at: str | None = None
    revoked_at: str | None = None


@dataclass
class _MemoryBackend:
    runs: dict[str, LocalRunRecord]
    traces: dict[str, LocalTraceRecord]
    trace_spans: dict[str, list[LocalTraceSpanRecord]]
    sessions: dict[str, LocalSessionSummary]
    messages: dict[str, list[LocalMessageRecord]]
    agent_versions: dict[str, dict[str, list[_AgentVersion]]]
    agent_aliases: dict[str, dict[str, dict[str, str]]]
    evals: dict[str, dict[str, EvalDefinition]]
    datasets: dict[str, dict[str, EvalDataset]]
    eval_runs: dict[str, EvalRun]
    eval_latest_scores: dict[str, EvalLatestScore]
    api_keys: dict[str, _ApiKeyRow]
    api_key_by_hash: dict[str, _ApiKeyRow]


def _create_backend() -> _MemoryBackend:
    return _MemoryBackend(
        runs={},
        traces={},
        trace_spans={},
        sessions={},
        messages={},
        agent_versions={},
        agent_aliases={},
        evals={},
        datasets={},
        eval_runs={},
        eval_latest_scores={},
        api_keys={},
        api_key_by_hash={},
    )


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

    def put_trace_span(self, span: LocalTraceSpanRecord) -> None: ...

    def list_trace_spans(self, trace_id: str) -> list[LocalTraceSpanRecord]: ...

    def append_messages(
        self,
        session_id: str,
        messages: list[LocalMessageRecord],
        *,
        agent_id: str | None = None,
    ) -> None: ...

    def get_messages(self, session_id: str) -> list[LocalMessageRecord]: ...

    def list_sessions(
        self,
        *,
        agent_id: str | None = None,
    ) -> list[LocalSessionSummary]: ...

    def delete_session(self, session_id: str) -> None: ...


class MemoryStore:
    def __init__(
        self,
        *,
        user_id: str | None = DEFAULT_USER_ID,
        backend: _MemoryBackend | None = None,
        strict: bool = False,
    ) -> None:
        self.user_id = None if strict and user_id == DEFAULT_USER_ID else user_id
        self._backend = backend or _create_backend()
        self._last_ts = 0

    def for_user(self, user_id: str) -> MemoryStore:
        return MemoryStore(user_id=user_id, backend=self._backend)

    def forUser(self, user_id: str) -> MemoryStore:
        return self.for_user(user_id)

    def _require_user(self) -> str:
        if not self.user_id:
            raise RuntimeError("MemoryStore: user not set. Call for_user(id) first.")
        return self.user_id

    def _key(self, value: str) -> str:
        return f"{self._require_user()}:{value}"

    def _next_timestamp(self) -> str:
        now = int(datetime.now(tz=UTC).timestamp() * 1000)
        next_ms = now if now > self._last_ts else self._last_ts + 1
        self._last_ts = next_ms
        return datetime.fromtimestamp(next_ms / 1000, tz=UTC).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z")

    def put_run(self, run: LocalRunRecord) -> None:
        self._backend.runs[self._key(run.id)] = run

    def get_run(self, run_id: str) -> LocalRunRecord | None:
        return self._backend.runs.get(self._key(run_id))

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]:
        prefix = f"{self._require_user()}:"
        rows = [
            row for key, row in self._backend.runs.items() if key.startswith(prefix)
        ]
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return rows

    def _agent_map(self) -> dict[str, list[_AgentVersion]]:
        user_id = self._require_user()
        return self._backend.agent_versions.setdefault(user_id, {})

    def _alias_map(self) -> dict[str, dict[str, str]]:
        user_id = self._require_user()
        return self._backend.agent_aliases.setdefault(user_id, {})

    def list_agents(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for agent_id in self._agent_map():
            agent = self.get_agent(agent_id)
            if agent is None:
                continue
            row: dict[str, Any] = {"id": agent.id, "name": agent.name}
            if agent.description is not None:
                row["description"] = agent.description
            rows.append(row)
        return sorted(rows, key=lambda row: row["id"])

    def listAgents(self) -> list[dict[str, Any]]:
        return self.list_agents()

    def get_agent(self, agent_id: str) -> AgentDefinition | None:
        versions = self._agent_map().get(agent_id) or []
        if not versions:
            return None
        active = sorted(
            [version for version in versions if version.activated_at is not None],
            key=lambda version: version.activated_at or "",
            reverse=True,
        )
        return _clone_model(active[0].agent if active else versions[-1].agent, AgentDefinition)

    def getAgent(self, agent_id: str) -> AgentDefinition | None:
        return self.get_agent(agent_id)

    def put_agent(self, agent: AgentDefinition | dict[str, Any]) -> AgentDefinition:
        normalized = _agent(agent)
        now = self._next_timestamp()
        versions = self._agent_map().setdefault(normalized.id, [])
        row = normalized.model_copy(update={"created_at": now, "updated_at": now})
        versions.append(_AgentVersion(agent=row, created_at=now, activated_at=now))
        return _clone_model(row, AgentDefinition)

    def putAgent(self, agent: AgentDefinition | dict[str, Any]) -> AgentDefinition:
        return self.put_agent(agent)

    def put_agent_if_changed(
        self,
        agent: AgentDefinition | dict[str, Any],
        *,
        content_hash: str,
    ) -> AgentDefinition:
        normalized = _agent(agent)
        versions = self._agent_map().setdefault(normalized.id, [])
        for version in reversed(versions):
            metadata = version.agent.metadata or {}
            if metadata.get("contentHash") == content_hash:
                return _clone_model(version.agent, AgentDefinition)
        metadata = dict(normalized.metadata or {})
        metadata["contentHash"] = content_hash
        return self.put_agent(normalized.model_copy(update={"metadata": metadata}))

    def delete_agent(self, agent_id: str) -> None:
        self._agent_map().pop(agent_id, None)
        self._alias_map().pop(agent_id, None)

    def deleteAgent(self, agent_id: str) -> None:
        self.delete_agent(agent_id)

    def list_agent_versions(self, agent_id: str) -> list[AgentVersionSummary]:
        aliases_by_version: dict[str, list[str]] = {}
        for alias, created_at in self._alias_map().get(agent_id, {}).items():
            aliases_by_version.setdefault(created_at, []).append(alias)
        return [
            AgentVersionSummary(
                createdAt=version.created_at,
                activatedAt=version.activated_at,
                aliases=sorted(aliases_by_version.get(version.created_at, [])),
            )
            for version in reversed(self._agent_map().get(agent_id, []))
        ]

    def listAgentVersions(self, agent_id: str) -> list[AgentVersionSummary]:
        return self.list_agent_versions(agent_id)

    def get_agent_version(self, agent_id: str, created_at: str) -> AgentDefinition | None:
        for version in self._agent_map().get(agent_id, []):
            if version.created_at == created_at:
                return _clone_model(version.agent, AgentDefinition)
        return None

    def getAgentVersion(self, agent_id: str, created_at: str) -> AgentDefinition | None:
        return self.get_agent_version(agent_id, created_at)

    def activate_agent_version(self, agent_id: str, created_at: str) -> None:
        for version in self._agent_map().get(agent_id, []):
            if version.created_at == created_at:
                version.activated_at = self._next_timestamp()
                return

    def activateAgentVersion(self, agent_id: str, created_at: str) -> None:
        self.activate_agent_version(agent_id, created_at)

    def resolve_agent_alias(self, agent_id: str, alias: str) -> str | None:
        return self._alias_map().get(agent_id, {}).get(alias)

    def resolveAgentAlias(self, agent_id: str, alias: str) -> str | None:
        return self.resolve_agent_alias(agent_id, alias)

    def set_agent_version_alias(self, agent_id: str, created_at: str, alias: str) -> None:
        if self.get_agent_version(agent_id, created_at) is None:
            raise ValueError(f"Agent version not found: {agent_id}@{created_at}")
        self._alias_map().setdefault(agent_id, {})[alias] = created_at

    def setAgentVersionAlias(self, agent_id: str, created_at: str, alias: str) -> None:
        self.set_agent_version_alias(agent_id, created_at, alias)

    def remove_agent_version_alias(self, agent_id: str, alias: str) -> None:
        self._alias_map().get(agent_id, {}).pop(alias, None)

    def removeAgentVersionAlias(self, agent_id: str, alias: str) -> None:
        self.remove_agent_version_alias(agent_id, alias)

    def _eval_map(self) -> dict[str, EvalDefinition]:
        return self._backend.evals.setdefault(self._require_user(), {})

    def list_evals(self, *, agent_id: str | None = None) -> list[EvalDefinition]:
        rows = [_clone_model(row, EvalDefinition) for row in self._eval_map().values()]
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        return sorted(rows, key=lambda row: row.updated_at or "", reverse=True)

    def listEvals(self, filters: dict[str, Any] | None = None) -> list[EvalDefinition]:
        return self.list_evals(
            agent_id=(filters or {}).get("agentId") or (filters or {}).get("agent_id")
        )

    def get_eval(self, eval_id: str) -> EvalDefinition | None:
        row = self._eval_map().get(eval_id)
        return _clone_model(row, EvalDefinition) if row is not None else None

    def getEval(self, eval_id: str) -> EvalDefinition | None:
        return self.get_eval(eval_id)

    def put_eval(self, definition: EvalDefinition | dict[str, Any]) -> EvalDefinition:
        normalized = _eval_definition(definition)
        existing = self._eval_map().get(normalized.id)
        now = self._next_timestamp()
        row = normalized.model_copy(
            update={
                "created_at": existing.created_at
                if existing
                else normalized.created_at or now,
                "updated_at": now,
            }
        )
        self._eval_map()[row.id] = row
        return _clone_model(row, EvalDefinition)

    def putEval(self, definition: EvalDefinition | dict[str, Any]) -> EvalDefinition:
        return self.put_eval(definition)

    def delete_eval(self, eval_id: str) -> None:
        self._eval_map().pop(eval_id, None)

    def deleteEval(self, eval_id: str) -> None:
        self.delete_eval(eval_id)

    def _dataset_map(self) -> dict[str, EvalDataset]:
        return self._backend.datasets.setdefault(self._require_user(), {})

    def list_datasets(self, *, agent_id: str | None = None) -> list[EvalDataset]:
        rows = [_clone_model(row, EvalDataset) for row in self._dataset_map().values()]
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        return sorted(rows, key=lambda row: row.updated_at or "", reverse=True)

    def listDatasets(self, filters: dict[str, Any] | None = None) -> list[EvalDataset]:
        return self.list_datasets(
            agent_id=(filters or {}).get("agentId") or (filters or {}).get("agent_id")
        )

    def get_dataset(self, dataset_id: str) -> EvalDataset | None:
        row = self._dataset_map().get(dataset_id)
        return _clone_model(row, EvalDataset) if row is not None else None

    def getDataset(self, dataset_id: str) -> EvalDataset | None:
        return self.get_dataset(dataset_id)

    def put_dataset(self, dataset: EvalDataset | dict[str, Any]) -> EvalDataset:
        normalized = _dataset(dataset)
        existing = self._dataset_map().get(normalized.id)
        now = self._next_timestamp()
        row = normalized.model_copy(
            update={
                "created_at": existing.created_at
                if existing
                else normalized.created_at or now,
                "updated_at": now,
            }
        )
        self._dataset_map()[row.id] = row
        return _clone_model(row, EvalDataset)

    def putDataset(self, dataset: EvalDataset | dict[str, Any]) -> EvalDataset:
        return self.put_dataset(dataset)

    def delete_dataset(self, dataset_id: str) -> None:
        self._dataset_map().pop(dataset_id, None)

    def deleteDataset(self, dataset_id: str) -> None:
        self.delete_dataset(dataset_id)

    def _eval_run_key(self, run_id: str) -> str:
        return f"{self._require_user()}:{run_id}"

    def put_eval_run(self, run: EvalRun | dict[str, Any]) -> EvalRun:
        normalized = _eval_run(run)
        self._backend.eval_runs[self._eval_run_key(normalized.id)] = normalized
        return _clone_model(normalized, EvalRun)

    def putEvalRun(self, run: EvalRun | dict[str, Any]) -> EvalRun:
        return self.put_eval_run(run)

    def get_eval_run(self, run_id: str) -> EvalRun | None:
        row = self._backend.eval_runs.get(self._eval_run_key(run_id))
        return _clone_model(row, EvalRun) if row is not None else None

    def getEvalRun(self, run_id: str) -> EvalRun | None:
        return self.get_eval_run(run_id)

    def list_eval_runs(self, **filters: Any) -> EvalRunListResult:
        prefix = f"{self._require_user()}:"
        rows = [
            _clone_model(row, EvalRun)
            for key, row in self._backend.eval_runs.items()
            if key.startswith(prefix)
        ]
        return list_eval_runs_in_process(rows, filters)

    def listEvalRuns(self, filters: dict[str, Any] | None = None) -> EvalRunListResult:
        return self.list_eval_runs(**(filters or {}))

    def _latest_score_key(
        self,
        *,
        eval_id: str,
        dataset_id: str,
        resolved_agent_version: str | None,
    ) -> str:
        return f"{self._require_user()}:{eval_id}:{dataset_id}:{resolved_agent_version or ''}"

    def get_eval_latest_score(
        self,
        *,
        eval_id: str,
        dataset_id: str,
        resolved_agent_version: str | None = None,
    ) -> EvalLatestScore | None:
        row = self._backend.eval_latest_scores.get(
            self._latest_score_key(
                eval_id=eval_id,
                dataset_id=dataset_id,
                resolved_agent_version=resolved_agent_version,
            )
        )
        return _clone_model(row, EvalLatestScore) if row is not None else None

    def getEvalLatestScore(self, key: dict[str, Any]) -> EvalLatestScore | None:
        return self.get_eval_latest_score(
            eval_id=key["evalId"],
            dataset_id=key["datasetId"],
            resolved_agent_version=key.get("resolvedAgentVersion"),
        )

    def list_eval_latest_scores(self, **filters: Any) -> list[EvalLatestScore]:
        prefix = f"{self._require_user()}:"
        rows = [
            _clone_model(row, EvalLatestScore)
            for key, row in self._backend.eval_latest_scores.items()
            if key.startswith(prefix)
        ]
        agent_id = filters.get("agent_id") or filters.get("agentId")
        eval_id = filters.get("eval_id") or filters.get("evalId")
        dataset_id = filters.get("dataset_id") or filters.get("datasetId")
        resolved_version = filters.get("resolved_agent_version")
        if "resolvedAgentVersion" in filters:
            resolved_version = filters["resolvedAgentVersion"]
        status = filters.get("status")
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        if eval_id is not None:
            rows = [row for row in rows if row.eval_id == eval_id]
        if dataset_id is not None:
            rows = [row for row in rows if row.dataset_id == dataset_id]
        if resolved_version is not None:
            rows = [row for row in rows if row.resolved_agent_version == resolved_version]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return sorted(
            rows,
            key=lambda row: (row.updated_at, row.started_at, row.run_id),
            reverse=True,
        )

    def listEvalLatestScores(self, filters: dict[str, Any] | None = None) -> list[EvalLatestScore]:
        return self.list_eval_latest_scores(**(filters or {}))

    def put_eval_latest_score(self, score: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
        normalized = _latest_score(score)
        self._backend.eval_latest_scores[
            self._latest_score_key(
                eval_id=normalized.eval_id,
                dataset_id=normalized.dataset_id,
                resolved_agent_version=normalized.resolved_agent_version,
            )
        ] = normalized
        return _clone_model(normalized, EvalLatestScore)

    def putEvalLatestScore(self, score: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
        return self.put_eval_latest_score(score)

    def create_api_key(self, *, user_id: str, name: str) -> dict[str, Any]:
        raw_key = f"ar_live_{secrets.token_urlsafe(24)}"
        row = _ApiKeyRow(
            id=f"key_{secrets.token_urlsafe(9)}",
            user_id=user_id,
            name=name,
            key_prefix=raw_key[:12],
            key_hash=_sha256(raw_key),
            created_at=self._next_timestamp(),
        )
        self._backend.api_keys[row.id] = row
        self._backend.api_key_by_hash[row.key_hash] = row
        return {"record": _api_key_record(row), "rawKey": raw_key, "raw_key": raw_key}

    def createApiKey(self, params: dict[str, str]) -> dict[str, Any]:
        return self.create_api_key(user_id=params["userId"], name=params["name"])

    def list_api_keys(self, user_id: str) -> list[ApiKeyRecord]:
        return [
            _api_key_record(row)
            for row in self._backend.api_keys.values()
            if row.user_id == user_id
        ]

    def listApiKeys(self, user_id: str) -> list[ApiKeyRecord]:
        return self.list_api_keys(user_id)

    def revoke_api_key(self, *, user_id: str, key_id: str) -> None:
        row = self._backend.api_keys.get(key_id)
        if row and row.user_id == user_id:
            row.revoked_at = self._next_timestamp()

    def revokeApiKey(self, params: dict[str, str]) -> None:
        self.revoke_api_key(user_id=params["userId"], key_id=params["keyId"])

    def resolve_api_key(self, raw_key: str) -> dict[str, str] | None:
        row = self._backend.api_key_by_hash.get(_sha256(raw_key))
        if row is None or row.revoked_at is not None:
            return None
        row.last_used_at = self._next_timestamp()
        return {"userId": row.user_id, "user_id": row.user_id, "keyId": row.id, "key_id": row.id}

    def resolveApiKey(self, raw_key: str) -> dict[str, str] | None:
        return self.resolve_api_key(raw_key)

    def put_trace_span(self, span: LocalTraceSpanRecord) -> None:
        self._backend.trace_spans.setdefault(self._key(span.trace_id), []).append(span)

    def list_trace_spans(self, trace_id: str) -> list[LocalTraceSpanRecord]:
        return list(self._backend.trace_spans.get(self._key(trace_id), []))

    def append_messages(
        self,
        session_id: str,
        messages: list[LocalMessageRecord],
        *,
        agent_id: str | None = None,
    ) -> None:
        if not messages:
            return
        key = self._key(session_id)
        existing = self._backend.sessions.get(key)
        created_at = existing.created_at if existing else messages[0].timestamp
        session_agent_id = agent_id or (existing.agent_id if existing else None)
        rows = self._backend.messages.setdefault(key, [])
        rows.extend(messages)
        self._backend.sessions[key] = LocalSessionSummary(
            session_id=session_id,
            agent_id=session_agent_id,
            message_count=len(rows),
            created_at=created_at,
            updated_at=messages[-1].timestamp,
        )

    def get_messages(self, session_id: str) -> list[LocalMessageRecord]:
        return list(self._backend.messages.get(self._key(session_id), []))

    def list_sessions(
        self,
        *,
        agent_id: str | None = None,
    ) -> list[LocalSessionSummary]:
        prefix = f"{self._require_user()}:"
        rows = [
            row for key, row in self._backend.sessions.items() if key.startswith(prefix)
        ]
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        return sorted(rows, key=lambda row: row.updated_at, reverse=True)

    def delete_session(self, session_id: str) -> None:
        key = self._key(session_id)
        self._backend.sessions.pop(key, None)
        self._backend.messages.pop(key, None)

    def put_trace(self, trace: LocalTraceRecord) -> None:
        self._backend.traces[self._key(trace.trace_id)] = trace

    def get_trace(self, trace_id: str) -> LocalTraceRecord | None:
        return self._backend.traces.get(self._key(trace_id))

    def list_traces(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalTraceRecord]:
        prefix = f"{self._require_user()}:"
        rows = [
            row for key, row in self._backend.traces.items() if key.startswith(prefix)
        ]
        if agent_id is not None:
            rows = [row for row in rows if row.agent_id == agent_id]
        if status is not None:
            rows = [row for row in rows if row.status == status]
        return rows


def _clone_model(value: Any, model: type[Any]) -> Any:
    return model.model_validate(
        value.model_dump(by_alias=True) if hasattr(value, "model_dump") else value
    )


def _agent(value: AgentDefinition | dict[str, Any]) -> AgentDefinition:
    return AgentDefinition.model_validate(value)


def _eval_definition(value: EvalDefinition | dict[str, Any]) -> EvalDefinition:
    return EvalDefinition.model_validate(value)


def _dataset(value: EvalDataset | dict[str, Any]) -> EvalDataset:
    return EvalDataset.model_validate(value)


def _eval_run(value: EvalRun | dict[str, Any]) -> EvalRun:
    return EvalRun.model_validate(value)


def _latest_score(value: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
    return EvalLatestScore.model_validate(value)


def _api_key_record(row: _ApiKeyRow) -> ApiKeyRecord:
    return ApiKeyRecord(
        id=row.id,
        userId=row.user_id,
        name=row.name,
        keyPrefix=row.key_prefix,
        createdAt=row.created_at,
        lastUsedAt=row.last_used_at,
        revokedAt=row.revoked_at,
    )


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
