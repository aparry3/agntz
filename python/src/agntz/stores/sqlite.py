"""SQLite-backed local run store."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

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

from .memory import (
    DEFAULT_USER_ID,
    LocalMessageRecord,
    LocalRunRecord,
    LocalSessionSummary,
    LocalTraceRecord,
    LocalTraceSpanRecord,
)


class SQLiteStore:
    def __init__(self, path: str | Path, *, user_id: str | None = DEFAULT_USER_ID) -> None:
        self.path = Path(path)
        self.user_id = user_id
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._migrate()

    def close(self) -> None:
        self._conn.close()

    def for_user(self, user_id: str) -> SQLiteStore:
        return SQLiteStore(self.path, user_id=user_id)

    def forUser(self, user_id: str) -> SQLiteStore:
        return self.for_user(user_id)

    def _require_user(self) -> str:
        if not self.user_id:
            raise RuntimeError("SQLiteStore: user not set. Call for_user(id) first.")
        return self.user_id

    def _next_timestamp(self) -> str:
        return datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")

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

    def put_trace_span(self, span: LocalTraceSpanRecord) -> None:
        self._conn.execute(
            """
            INSERT INTO trace_spans (
              span_id, trace_id, parent_id, run_id, session_id, name, kind,
              started_at, ended_at, status, error, attributes_json,
              events_json, scores_json, cost_usd
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                span.span_id,
                span.trace_id,
                span.parent_id,
                span.run_id,
                span.session_id,
                span.name,
                span.kind,
                span.started_at,
                span.ended_at,
                span.status,
                span.error,
                _dumps(span.attributes or {}),
                _dumps(span.events or []),
                _dumps(span.scores or {}),
                span.cost_usd,
            ),
        )
        self._conn.commit()

    def list_trace_spans(self, trace_id: str) -> list[LocalTraceSpanRecord]:
        rows = self._conn.execute(
            """
            SELECT *
            FROM trace_spans
            WHERE trace_id = ?
            ORDER BY id ASC
            """,
            (trace_id,),
        ).fetchall()
        return [_row_to_trace_span(row) for row in rows]

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

    def list_agents(self) -> list[dict[str, Any]]:
        user_id = self._require_user()
        rows = self._conn.execute(
            """
            SELECT DISTINCT agent_id
            FROM agent_versions
            WHERE user_id = ?
            ORDER BY agent_id ASC
            """,
            (user_id,),
        ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            agent = self.get_agent(row["agent_id"])
            if agent is None:
                continue
            summary: dict[str, Any] = {"id": agent.id, "name": agent.name}
            if agent.description is not None:
                summary["description"] = agent.description
            result.append(summary)
        return result

    def listAgents(self) -> list[dict[str, Any]]:
        return self.list_agents()

    def get_agent(self, agent_id: str) -> AgentDefinition | None:
        user_id = self._require_user()
        row = self._conn.execute(
            """
            SELECT agent_json
            FROM agent_versions
            WHERE user_id = ? AND agent_id = ?
            ORDER BY activated_at IS NULL ASC, activated_at DESC, created_at DESC
            LIMIT 1
            """,
            (user_id, agent_id),
        ).fetchone()
        return AgentDefinition.model_validate(_loads(row["agent_json"])) if row else None

    def getAgent(self, agent_id: str) -> AgentDefinition | None:
        return self.get_agent(agent_id)

    def put_agent(self, agent: AgentDefinition | dict[str, Any]) -> AgentDefinition:
        user_id = self._require_user()
        normalized = AgentDefinition.model_validate(agent)
        now = self._next_timestamp()
        row = normalized.model_copy(update={"created_at": now, "updated_at": now})
        self._conn.execute(
            """
            INSERT INTO agent_versions (user_id, agent_id, created_at, activated_at, agent_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, row.id, now, now, _dumps(row.model_dump(by_alias=True, exclude_none=True))),
        )
        self._conn.commit()
        return row

    def putAgent(self, agent: AgentDefinition | dict[str, Any]) -> AgentDefinition:
        return self.put_agent(agent)

    def put_agent_if_changed(
        self,
        agent: AgentDefinition | dict[str, Any],
        *,
        content_hash: str,
    ) -> AgentDefinition:
        normalized = AgentDefinition.model_validate(agent)
        user_id = self._require_user()
        row = self._conn.execute(
            """
            SELECT agent_json
            FROM agent_versions
            WHERE user_id = ? AND agent_id = ?
            ORDER BY created_at DESC
            """,
            (user_id, normalized.id),
        ).fetchall()
        for candidate in row:
            existing = AgentDefinition.model_validate(_loads(candidate["agent_json"]))
            if (existing.metadata or {}).get("contentHash") == content_hash:
                return existing
        metadata = dict(normalized.metadata or {})
        metadata["contentHash"] = content_hash
        return self.put_agent(normalized.model_copy(update={"metadata": metadata}))

    def delete_agent(self, agent_id: str) -> None:
        user_id = self._require_user()
        with self._conn:
            self._conn.execute(
                "DELETE FROM agent_aliases WHERE user_id = ? AND agent_id = ?",
                (user_id, agent_id),
            )
            self._conn.execute(
                "DELETE FROM agent_versions WHERE user_id = ? AND agent_id = ?",
                (user_id, agent_id),
            )

    def deleteAgent(self, agent_id: str) -> None:
        self.delete_agent(agent_id)

    def list_agent_versions(self, agent_id: str) -> list[AgentVersionSummary]:
        user_id = self._require_user()
        rows = self._conn.execute(
            """
            SELECT created_at, activated_at
            FROM agent_versions
            WHERE user_id = ? AND agent_id = ?
            ORDER BY created_at DESC
            """,
            (user_id, agent_id),
        ).fetchall()
        alias_rows = self._conn.execute(
            """
            SELECT alias, version_created_at
            FROM agent_aliases
            WHERE user_id = ? AND agent_id = ?
            """,
            (user_id, agent_id),
        ).fetchall()
        aliases: dict[str, list[str]] = {}
        for row in alias_rows:
            aliases.setdefault(row["version_created_at"], []).append(row["alias"])
        return [
            AgentVersionSummary(
                createdAt=row["created_at"],
                activatedAt=row["activated_at"],
                aliases=sorted(aliases.get(row["created_at"], [])),
            )
            for row in rows
        ]

    def listAgentVersions(self, agent_id: str) -> list[AgentVersionSummary]:
        return self.list_agent_versions(agent_id)

    def get_agent_version(self, agent_id: str, created_at: str) -> AgentDefinition | None:
        row = self._conn.execute(
            """
            SELECT agent_json
            FROM agent_versions
            WHERE user_id = ? AND agent_id = ? AND created_at = ?
            """,
            (self._require_user(), agent_id, created_at),
        ).fetchone()
        return AgentDefinition.model_validate(_loads(row["agent_json"])) if row else None

    def getAgentVersion(self, agent_id: str, created_at: str) -> AgentDefinition | None:
        return self.get_agent_version(agent_id, created_at)

    def activate_agent_version(self, agent_id: str, created_at: str) -> None:
        self._conn.execute(
            """
            UPDATE agent_versions
            SET activated_at = ?
            WHERE user_id = ? AND agent_id = ? AND created_at = ?
            """,
            (self._next_timestamp(), self._require_user(), agent_id, created_at),
        )
        self._conn.commit()

    def activateAgentVersion(self, agent_id: str, created_at: str) -> None:
        self.activate_agent_version(agent_id, created_at)

    def resolve_agent_alias(self, agent_id: str, alias: str) -> str | None:
        row = self._conn.execute(
            """
            SELECT version_created_at
            FROM agent_aliases
            WHERE user_id = ? AND agent_id = ? AND alias = ?
            """,
            (self._require_user(), agent_id, alias),
        ).fetchone()
        return row["version_created_at"] if row else None

    def resolveAgentAlias(self, agent_id: str, alias: str) -> str | None:
        return self.resolve_agent_alias(agent_id, alias)

    def set_agent_version_alias(self, agent_id: str, created_at: str, alias: str) -> None:
        if self.get_agent_version(agent_id, created_at) is None:
            raise ValueError(f"Agent version not found: {agent_id}@{created_at}")
        self._conn.execute(
            """
            INSERT INTO agent_aliases (user_id, agent_id, alias, version_created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, agent_id, alias) DO UPDATE SET
              version_created_at=excluded.version_created_at
            """,
            (self._require_user(), agent_id, alias, created_at),
        )
        self._conn.commit()

    def setAgentVersionAlias(self, agent_id: str, created_at: str, alias: str) -> None:
        self.set_agent_version_alias(agent_id, created_at, alias)

    def remove_agent_version_alias(self, agent_id: str, alias: str) -> None:
        self._conn.execute(
            "DELETE FROM agent_aliases WHERE user_id = ? AND agent_id = ? AND alias = ?",
            (self._require_user(), agent_id, alias),
        )
        self._conn.commit()

    def removeAgentVersionAlias(self, agent_id: str, alias: str) -> None:
        self.remove_agent_version_alias(agent_id, alias)

    def list_evals(self, *, agent_id: str | None = None) -> list[EvalDefinition]:
        query = "SELECT definition_json FROM evals WHERE user_id = ?"
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND agent_id = ?"
            params.append(agent_id)
        query += " ORDER BY updated_at DESC"
        rows = self._conn.execute(query, params).fetchall()
        return [EvalDefinition.model_validate(_loads(row["definition_json"])) for row in rows]

    def listEvals(self, filters: dict[str, Any] | None = None) -> list[EvalDefinition]:
        return self.list_evals(
            agent_id=(filters or {}).get("agentId") or (filters or {}).get("agent_id")
        )

    def get_eval(self, eval_id: str) -> EvalDefinition | None:
        row = self._conn.execute(
            "SELECT definition_json FROM evals WHERE user_id = ? AND id = ?",
            (self._require_user(), eval_id),
        ).fetchone()
        return EvalDefinition.model_validate(_loads(row["definition_json"])) if row else None

    def getEval(self, eval_id: str) -> EvalDefinition | None:
        return self.get_eval(eval_id)

    def put_eval(self, definition: EvalDefinition | dict[str, Any]) -> EvalDefinition:
        normalized = EvalDefinition.model_validate(definition)
        existing = self.get_eval(normalized.id)
        now = self._next_timestamp()
        row = normalized.model_copy(
            update={
                "created_at": existing.created_at
                if existing
                else normalized.created_at or now,
                "updated_at": now,
            }
        )
        self._conn.execute(
            """
            INSERT INTO evals (user_id, id, agent_id, definition_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, id) DO UPDATE SET
              agent_id=excluded.agent_id,
              definition_json=excluded.definition_json,
              updated_at=excluded.updated_at
            """,
            (
                self._require_user(),
                row.id,
                row.agent_id,
                _dumps(row.model_dump(by_alias=True, exclude_none=True)),
                row.created_at,
                row.updated_at,
            ),
        )
        self._conn.commit()
        return row

    def putEval(self, definition: EvalDefinition | dict[str, Any]) -> EvalDefinition:
        return self.put_eval(definition)

    def delete_eval(self, eval_id: str) -> None:
        self._conn.execute(
            "DELETE FROM evals WHERE user_id = ? AND id = ?",
            (self._require_user(), eval_id),
        )
        self._conn.commit()

    def deleteEval(self, eval_id: str) -> None:
        self.delete_eval(eval_id)

    def list_datasets(self, *, agent_id: str | None = None) -> list[EvalDataset]:
        query = "SELECT dataset_json FROM eval_datasets WHERE user_id = ?"
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND agent_id = ?"
            params.append(agent_id)
        query += " ORDER BY updated_at DESC"
        rows = self._conn.execute(query, params).fetchall()
        return [EvalDataset.model_validate(_loads(row["dataset_json"])) for row in rows]

    def listDatasets(self, filters: dict[str, Any] | None = None) -> list[EvalDataset]:
        return self.list_datasets(
            agent_id=(filters or {}).get("agentId") or (filters or {}).get("agent_id")
        )

    def get_dataset(self, dataset_id: str) -> EvalDataset | None:
        row = self._conn.execute(
            "SELECT dataset_json FROM eval_datasets WHERE user_id = ? AND id = ?",
            (self._require_user(), dataset_id),
        ).fetchone()
        return EvalDataset.model_validate(_loads(row["dataset_json"])) if row else None

    def getDataset(self, dataset_id: str) -> EvalDataset | None:
        return self.get_dataset(dataset_id)

    def put_dataset(self, dataset: EvalDataset | dict[str, Any]) -> EvalDataset:
        normalized = EvalDataset.model_validate(dataset)
        existing = self.get_dataset(normalized.id)
        now = self._next_timestamp()
        row = normalized.model_copy(
            update={
                "created_at": existing.created_at
                if existing
                else normalized.created_at or now,
                "updated_at": now,
            }
        )
        self._conn.execute(
            """
            INSERT INTO eval_datasets (
              user_id, id, agent_id, name, dataset_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, id) DO UPDATE SET
              agent_id=excluded.agent_id,
              name=excluded.name,
              dataset_json=excluded.dataset_json,
              updated_at=excluded.updated_at
            """,
            (
                self._require_user(),
                row.id,
                row.agent_id,
                row.name,
                _dumps(row.model_dump(by_alias=True, exclude_none=True)),
                row.created_at,
                row.updated_at,
            ),
        )
        self._conn.commit()
        return row

    def putDataset(self, dataset: EvalDataset | dict[str, Any]) -> EvalDataset:
        return self.put_dataset(dataset)

    def delete_dataset(self, dataset_id: str) -> None:
        self._conn.execute(
            "DELETE FROM eval_datasets WHERE user_id = ? AND id = ?",
            (self._require_user(), dataset_id),
        )
        self._conn.commit()

    def deleteDataset(self, dataset_id: str) -> None:
        self.delete_dataset(dataset_id)

    def put_eval_run(self, run: EvalRun | dict[str, Any]) -> EvalRun:
        normalized = EvalRun.model_validate(run)
        self._conn.execute(
            """
            INSERT INTO eval_runs (
              user_id, id, eval_id, dataset_id, agent_id, agent_version,
              requested_agent_version, status, started_at, run_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, id) DO UPDATE SET
              status=excluded.status,
              run_json=excluded.run_json
            """,
            (
                self._require_user(),
                normalized.id,
                normalized.eval_id,
                normalized.dataset_id,
                normalized.agent_id,
                normalized.agent_version,
                normalized.requested_agent_version,
                normalized.status,
                normalized.started_at,
                _dumps(normalized.model_dump(by_alias=True, exclude_none=True)),
            ),
        )
        self._conn.commit()
        return normalized

    def putEvalRun(self, run: EvalRun | dict[str, Any]) -> EvalRun:
        return self.put_eval_run(run)

    def get_eval_run(self, run_id: str) -> EvalRun | None:
        row = self._conn.execute(
            "SELECT run_json FROM eval_runs WHERE user_id = ? AND id = ?",
            (self._require_user(), run_id),
        ).fetchone()
        return EvalRun.model_validate(_loads(row["run_json"])) if row else None

    def getEvalRun(self, run_id: str) -> EvalRun | None:
        return self.get_eval_run(run_id)

    def list_eval_runs(self, **filters: Any) -> EvalRunListResult:
        rows = self._conn.execute(
            "SELECT run_json FROM eval_runs WHERE user_id = ?",
            (self._require_user(),),
        ).fetchall()
        return list_eval_runs_in_process(
            [EvalRun.model_validate(_loads(row["run_json"])) for row in rows],
            filters,
        )

    def listEvalRuns(self, filters: dict[str, Any] | None = None) -> EvalRunListResult:
        return self.list_eval_runs(**(filters or {}))

    def get_eval_latest_score(
        self,
        *,
        eval_id: str,
        dataset_id: str,
        resolved_agent_version: str | None = None,
    ) -> EvalLatestScore | None:
        row = self._conn.execute(
            """
            SELECT score_json
            FROM eval_latest_scores
            WHERE user_id = ? AND eval_id = ? AND dataset_id = ?
              AND resolved_agent_version = ?
            """,
            (self._require_user(), eval_id, dataset_id, resolved_agent_version or ""),
        ).fetchone()
        return EvalLatestScore.model_validate(_loads(row["score_json"])) if row else None

    def getEvalLatestScore(self, key: dict[str, Any]) -> EvalLatestScore | None:
        return self.get_eval_latest_score(
            eval_id=key["evalId"],
            dataset_id=key["datasetId"],
            resolved_agent_version=key.get("resolvedAgentVersion"),
        )

    def list_eval_latest_scores(self, **filters: Any) -> list[EvalLatestScore]:
        query = "SELECT score_json FROM eval_latest_scores WHERE user_id = ?"
        params: list[Any] = [self._require_user()]
        mapping = [
            ("agent_id", "agentId", "agent_id"),
            ("eval_id", "evalId", "eval_id"),
            ("dataset_id", "datasetId", "dataset_id"),
            ("status", "status", "status"),
        ]
        for snake, camel, column in mapping:
            value = filters.get(snake) if snake in filters else filters.get(camel)
            if value is not None:
                query += f" AND {column} = ?"
                params.append(value)
        if "resolved_agent_version" in filters or "resolvedAgentVersion" in filters:
            query += " AND resolved_agent_version = ?"
            params.append(
                filters.get("resolved_agent_version", filters.get("resolvedAgentVersion"))
                or ""
            )
        query += " ORDER BY updated_at DESC, started_at DESC, run_id DESC"
        rows = self._conn.execute(query, params).fetchall()
        return [EvalLatestScore.model_validate(_loads(row["score_json"])) for row in rows]

    def listEvalLatestScores(self, filters: dict[str, Any] | None = None) -> list[EvalLatestScore]:
        return self.list_eval_latest_scores(**(filters or {}))

    def put_eval_latest_score(self, score: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
        normalized = EvalLatestScore.model_validate(score)
        self._conn.execute(
            """
            INSERT INTO eval_latest_scores (
              user_id, eval_id, dataset_id, resolved_agent_version, agent_id,
              requested_agent_version, run_id, status, overall_score, passed,
              started_at, updated_at, score_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, eval_id, dataset_id, resolved_agent_version)
            DO UPDATE SET
              agent_id=excluded.agent_id,
              requested_agent_version=excluded.requested_agent_version,
              run_id=excluded.run_id,
              status=excluded.status,
              overall_score=excluded.overall_score,
              passed=excluded.passed,
              started_at=excluded.started_at,
              updated_at=excluded.updated_at,
              score_json=excluded.score_json
            """,
            (
                self._require_user(),
                normalized.eval_id,
                normalized.dataset_id,
                normalized.resolved_agent_version or "",
                normalized.agent_id,
                normalized.requested_agent_version,
                normalized.run_id,
                normalized.status,
                normalized.overall_score,
                1 if normalized.passed else 0,
                normalized.started_at,
                normalized.updated_at,
                _dumps(normalized.model_dump(by_alias=True, exclude_none=True)),
            ),
        )
        self._conn.commit()
        return normalized

    def putEvalLatestScore(self, score: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
        return self.put_eval_latest_score(score)

    def create_api_key(self, *, user_id: str, name: str) -> dict[str, Any]:
        raw_key = f"ar_live_{secrets.token_urlsafe(24)}"
        now = self._next_timestamp()
        key_id = f"key_{secrets.token_urlsafe(9)}"
        self._conn.execute(
            """
            INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (key_id, user_id, name, raw_key[:12], _sha256(raw_key), now),
        )
        self._conn.commit()
        return {
            "record": ApiKeyRecord(
                id=key_id,
                userId=user_id,
                name=name,
                keyPrefix=raw_key[:12],
                createdAt=now,
                lastUsedAt=None,
                revokedAt=None,
            ),
            "rawKey": raw_key,
            "raw_key": raw_key,
        }

    def createApiKey(self, params: dict[str, str]) -> dict[str, Any]:
        return self.create_api_key(user_id=params["userId"], name=params["name"])

    def list_api_keys(self, user_id: str) -> list[ApiKeyRecord]:
        rows = self._conn.execute(
            "SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return [_row_to_api_key(row) for row in rows]

    def listApiKeys(self, user_id: str) -> list[ApiKeyRecord]:
        return self.list_api_keys(user_id)

    def revoke_api_key(self, *, user_id: str, key_id: str) -> None:
        self._conn.execute(
            "UPDATE api_keys SET revoked_at = ? WHERE user_id = ? AND id = ?",
            (self._next_timestamp(), user_id, key_id),
        )
        self._conn.commit()

    def revokeApiKey(self, params: dict[str, str]) -> None:
        self.revoke_api_key(user_id=params["userId"], key_id=params["keyId"])

    def resolve_api_key(self, raw_key: str) -> dict[str, str] | None:
        row = self._conn.execute(
            "SELECT * FROM api_keys WHERE key_hash = ?",
            (_sha256(raw_key),),
        ).fetchone()
        if not row or row["revoked_at"] is not None:
            return None
        self._conn.execute(
            "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
            (self._next_timestamp(), row["id"]),
        )
        self._conn.commit()
        return {
            "userId": row["user_id"],
            "user_id": row["user_id"],
            "keyId": row["id"],
            "key_id": row["id"],
        }

    def resolveApiKey(self, raw_key: str) -> dict[str, str] | None:
        return self.resolve_api_key(raw_key)

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
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS trace_spans (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              span_id TEXT NOT NULL,
              trace_id TEXT NOT NULL,
              parent_id TEXT,
              run_id TEXT,
              session_id TEXT,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              started_at REAL NOT NULL,
              ended_at REAL,
              status TEXT NOT NULL,
              error TEXT,
              attributes_json TEXT,
              events_json TEXT,
              scores_json TEXT,
              cost_usd REAL
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_trace_spans_trace ON trace_spans(trace_id)"
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_versions (
              user_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              created_at TEXT NOT NULL,
              activated_at TEXT,
              agent_json TEXT NOT NULL,
              PRIMARY KEY (user_id, agent_id, created_at)
            )
            """
        )
        self._conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_versions_active
            ON agent_versions(user_id, agent_id, activated_at DESC)
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_aliases (
              user_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              alias TEXT NOT NULL,
              version_created_at TEXT NOT NULL,
              PRIMARY KEY (user_id, agent_id, alias)
            )
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS evals (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              definition_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (user_id, id)
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_evals_user_agent ON evals(user_id, agent_id)"
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eval_datasets (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              name TEXT NOT NULL,
              dataset_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (user_id, id)
            )
            """
        )
        self._conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eval_datasets_user_agent
            ON eval_datasets(user_id, agent_id)
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eval_runs (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              eval_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              agent_version TEXT,
              requested_agent_version TEXT,
              status TEXT NOT NULL,
              started_at TEXT NOT NULL,
              run_json TEXT NOT NULL,
              PRIMARY KEY (user_id, id)
            )
            """
        )
        self._conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eval_runs_user_started
            ON eval_runs(user_id, started_at DESC)
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS eval_latest_scores (
              user_id TEXT NOT NULL,
              eval_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              resolved_agent_version TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              requested_agent_version TEXT,
              run_id TEXT NOT NULL,
              status TEXT NOT NULL,
              overall_score REAL NOT NULL,
              passed INTEGER NOT NULL,
              started_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              score_json TEXT NOT NULL,
              PRIMARY KEY (user_id, eval_id, dataset_id, resolved_agent_version)
            )
            """
        )
        self._conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eval_latest_scores_user_agent
            ON eval_latest_scores(user_id, agent_id, updated_at DESC)
            """
        )
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_keys (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              name TEXT NOT NULL,
              key_prefix TEXT NOT NULL,
              key_hash TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL,
              last_used_at TEXT,
              revoked_at TEXT
            )
            """
        )
        self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)"
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


def _row_to_trace_span(row: sqlite3.Row) -> LocalTraceSpanRecord:
    return LocalTraceSpanRecord(
        span_id=row["span_id"],
        trace_id=row["trace_id"],
        parent_id=row["parent_id"],
        run_id=row["run_id"],
        session_id=row["session_id"],
        name=row["name"],
        kind=row["kind"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        status=row["status"],
        error=row["error"],
        attributes=_loads(row["attributes_json"]) or {},
        events=_loads(row["events_json"]) or [],
        scores=_loads(row["scores_json"]) or {},
        cost_usd=row["cost_usd"],
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


def _row_to_api_key(row: sqlite3.Row) -> ApiKeyRecord:
    return ApiKeyRecord(
        id=row["id"],
        userId=row["user_id"],
        name=row["name"],
        keyPrefix=row["key_prefix"],
        createdAt=row["created_at"],
        lastUsedAt=row["last_used_at"],
        revokedAt=row["revoked_at"],
    )


def _dumps(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _loads(value: str | None) -> Any:
    if value is None:
        return None
    return json.loads(value)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
