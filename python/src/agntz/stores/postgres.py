"""Postgres-backed synchronous store for hosted Python services."""
# pyright: reportMissingImports=false

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
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
    LocalMessageRecord,
    LocalRunRecord,
    LocalSessionSummary,
    LocalTraceRecord,
    LocalTraceSpanRecord,
)


class PostgresStore:
    def __init__(
        self,
        dsn: str,
        *,
        user_id: str | None = None,
        table_prefix: str = "ar_",
        skip_migration: bool = False,
    ) -> None:
        self.dsn = dsn
        self.user_id = user_id
        self.table_prefix = table_prefix
        self._psycopg = _import_psycopg()
        self._json = _import_json()
        self._conn = self._psycopg.connect(dsn)
        self._conn.autocommit = True
        self._last_ts = 0
        if not skip_migration:
            self._migrate()

    def close(self) -> None:
        self._conn.close()

    def for_user(self, user_id: str) -> PostgresStore:
        return PostgresStore(
            self.dsn,
            user_id=user_id,
            table_prefix=self.table_prefix,
            skip_migration=True,
        )

    def forUser(self, user_id: str) -> PostgresStore:
        return self.for_user(user_id)

    def _table(self, name: str) -> str:
        return f"{self.table_prefix}{name}"

    def _require_user(self) -> str:
        if not self.user_id:
            raise RuntimeError("PostgresStore: user not set. Call for_user(id) first.")
        return self.user_id

    def _next_timestamp(self) -> str:
        now = int(datetime.now(tz=UTC).timestamp() * 1000)
        next_ms = now if now > self._last_ts else self._last_ts + 1
        self._last_ts = next_ms
        return datetime.fromtimestamp(next_ms / 1000, tz=UTC).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z")

    def list_agents(self) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            f"""
            SELECT DISTINCT agent_id
            FROM {self._table("agents")}
            WHERE user_id = %s
            ORDER BY agent_id ASC
            """,
            (self._require_user(),),
        ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            agent = self.get_agent(row[0])
            if agent is None:
                continue
            item: dict[str, Any] = {"id": agent.id, "name": agent.name}
            if agent.description is not None:
                item["description"] = agent.description
            result.append(item)
        return result

    def listAgents(self) -> list[dict[str, Any]]:
        return self.list_agents()

    def get_agent(self, agent_id: str) -> AgentDefinition | None:
        row = self._conn.execute(
            f"""
            SELECT definition
            FROM {self._table("agents")}
            WHERE user_id = %s AND agent_id = %s
            ORDER BY activated_at IS NULL ASC, activated_at DESC, created_at DESC
            LIMIT 1
            """,
            (self._require_user(), agent_id),
        ).fetchone()
        return AgentDefinition.model_validate(row[0]) if row else None

    def getAgent(self, agent_id: str) -> AgentDefinition | None:
        return self.get_agent(agent_id)

    def put_agent(self, agent: AgentDefinition | dict[str, Any]) -> AgentDefinition:
        normalized = AgentDefinition.model_validate(agent)
        now = self._next_timestamp()
        row = normalized.model_copy(update={"created_at": now, "updated_at": now})
        self._conn.execute(
            f"""
            INSERT INTO {self._table("agents")}
              (user_id, agent_id, name, description, definition, created_at, activated_at)
            VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz)
            """,
            (
                self._require_user(),
                row.id,
                row.name,
                row.description,
                self._json(row.model_dump(by_alias=True, exclude_none=True)),
                now,
                now,
            ),
        )
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
        rows = self._conn.execute(
            f"""
            SELECT definition
            FROM {self._table("agents")}
            WHERE user_id = %s AND agent_id = %s
            ORDER BY created_at DESC
            """,
            (self._require_user(), normalized.id),
        ).fetchall()
        for row in rows:
            existing = AgentDefinition.model_validate(row[0])
            if (existing.metadata or {}).get("contentHash") == content_hash:
                return existing
        metadata = dict(normalized.metadata or {})
        metadata["contentHash"] = content_hash
        return self.put_agent(normalized.model_copy(update={"metadata": metadata}))

    def delete_agent(self, agent_id: str) -> None:
        self._conn.execute(
            f"DELETE FROM {self._table('agent_aliases')} WHERE user_id = %s AND agent_id = %s",
            (self._require_user(), agent_id),
        )
        self._conn.execute(
            f"DELETE FROM {self._table('agents')} WHERE user_id = %s AND agent_id = %s",
            (self._require_user(), agent_id),
        )

    def deleteAgent(self, agent_id: str) -> None:
        self.delete_agent(agent_id)

    def list_agent_versions(self, agent_id: str) -> list[AgentVersionSummary]:
        rows = self._conn.execute(
            f"""
            SELECT created_at::text, activated_at::text
            FROM {self._table("agents")}
            WHERE user_id = %s AND agent_id = %s
            ORDER BY created_at DESC
            """,
            (self._require_user(), agent_id),
        ).fetchall()
        alias_rows = self._conn.execute(
            f"""
            SELECT alias, version_created_at::text
            FROM {self._table("agent_aliases")}
            WHERE user_id = %s AND agent_id = %s
            """,
            (self._require_user(), agent_id),
        ).fetchall()
        aliases: dict[str, list[str]] = {}
        for alias, created_at in alias_rows:
            aliases.setdefault(_pg_iso(created_at), []).append(alias)
        return [
            AgentVersionSummary(
                createdAt=_pg_iso(created_at),
                activatedAt=_pg_iso(activated_at) if activated_at else None,
                aliases=sorted(aliases.get(_pg_iso(created_at), [])),
            )
            for created_at, activated_at in rows
        ]

    def listAgentVersions(self, agent_id: str) -> list[AgentVersionSummary]:
        return self.list_agent_versions(agent_id)

    def get_agent_version(self, agent_id: str, created_at: str) -> AgentDefinition | None:
        row = self._conn.execute(
            f"""
            SELECT definition
            FROM {self._table("agents")}
            WHERE user_id = %s AND agent_id = %s AND created_at = %s::timestamptz
            """,
            (self._require_user(), agent_id, created_at),
        ).fetchone()
        return AgentDefinition.model_validate(row[0]) if row else None

    def getAgentVersion(self, agent_id: str, created_at: str) -> AgentDefinition | None:
        return self.get_agent_version(agent_id, created_at)

    def activate_agent_version(self, agent_id: str, created_at: str) -> None:
        self._conn.execute(
            f"""
            UPDATE {self._table("agents")}
            SET activated_at = %s::timestamptz
            WHERE user_id = %s AND agent_id = %s AND created_at = %s::timestamptz
            """,
            (self._next_timestamp(), self._require_user(), agent_id, created_at),
        )

    def activateAgentVersion(self, agent_id: str, created_at: str) -> None:
        self.activate_agent_version(agent_id, created_at)

    def resolve_agent_alias(self, agent_id: str, alias: str) -> str | None:
        row = self._conn.execute(
            f"""
            SELECT version_created_at::text
            FROM {self._table("agent_aliases")}
            WHERE user_id = %s AND agent_id = %s AND alias = %s
            """,
            (self._require_user(), agent_id, alias),
        ).fetchone()
        return _pg_iso(row[0]) if row else None

    def resolveAgentAlias(self, agent_id: str, alias: str) -> str | None:
        return self.resolve_agent_alias(agent_id, alias)

    def set_agent_version_alias(self, agent_id: str, created_at: str, alias: str) -> None:
        if self.get_agent_version(agent_id, created_at) is None:
            raise ValueError(f"Agent version not found: {agent_id}@{created_at}")
        self._conn.execute(
            f"""
            INSERT INTO {self._table("agent_aliases")}
              (user_id, agent_id, alias, version_created_at)
            VALUES (%s, %s, %s, %s::timestamptz)
            ON CONFLICT (user_id, agent_id, alias)
            DO UPDATE SET version_created_at = EXCLUDED.version_created_at
            """,
            (self._require_user(), agent_id, alias, created_at),
        )

    def setAgentVersionAlias(self, agent_id: str, created_at: str, alias: str) -> None:
        self.set_agent_version_alias(agent_id, created_at, alias)

    def remove_agent_version_alias(self, agent_id: str, alias: str) -> None:
        self._conn.execute(
            f"""
            DELETE FROM {self._table("agent_aliases")}
            WHERE user_id = %s AND agent_id = %s AND alias = %s
            """,
            (self._require_user(), agent_id, alias),
        )

    def removeAgentVersionAlias(self, agent_id: str, alias: str) -> None:
        self.remove_agent_version_alias(agent_id, alias)

    def list_evals(self, *, agent_id: str | None = None) -> list[EvalDefinition]:
        query = f"SELECT definition FROM {self._table('evals')} WHERE user_id = %s"
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND agent_id = %s"
            params.append(agent_id)
        query += " ORDER BY updated_at DESC"
        return [EvalDefinition.model_validate(row[0]) for row in self._conn.execute(query, params)]

    def listEvals(self, filters: dict[str, Any] | None = None) -> list[EvalDefinition]:
        return self.list_evals(
            agent_id=(filters or {}).get("agentId") or (filters or {}).get("agent_id")
        )

    def get_eval(self, eval_id: str) -> EvalDefinition | None:
        row = self._conn.execute(
            f"SELECT definition FROM {self._table('evals')} WHERE user_id = %s AND id = %s",
            (self._require_user(), eval_id),
        ).fetchone()
        return EvalDefinition.model_validate(row[0]) if row else None

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
            f"""
            INSERT INTO {self._table("evals")}
              (user_id, id, agent_id, name, definition, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz)
            ON CONFLICT (user_id, id)
            DO UPDATE SET agent_id=EXCLUDED.agent_id, name=EXCLUDED.name,
              definition=EXCLUDED.definition, updated_at=EXCLUDED.updated_at
            """,
            (
                self._require_user(),
                row.id,
                row.agent_id,
                row.name,
                self._json(row.model_dump(by_alias=True, exclude_none=True)),
                row.created_at,
                row.updated_at,
            ),
        )
        return row

    def putEval(self, definition: EvalDefinition | dict[str, Any]) -> EvalDefinition:
        return self.put_eval(definition)

    def delete_eval(self, eval_id: str) -> None:
        self._conn.execute(
            f"DELETE FROM {self._table('evals')} WHERE user_id = %s AND id = %s",
            (self._require_user(), eval_id),
        )

    def deleteEval(self, eval_id: str) -> None:
        self.delete_eval(eval_id)

    def list_datasets(self, *, agent_id: str | None = None) -> list[EvalDataset]:
        query = f"SELECT dataset FROM {self._table('eval_datasets')} WHERE user_id = %s"
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND agent_id = %s"
            params.append(agent_id)
        query += " ORDER BY updated_at DESC"
        return [EvalDataset.model_validate(row[0]) for row in self._conn.execute(query, params)]

    def listDatasets(self, filters: dict[str, Any] | None = None) -> list[EvalDataset]:
        return self.list_datasets(
            agent_id=(filters or {}).get("agentId") or (filters or {}).get("agent_id")
        )

    def get_dataset(self, dataset_id: str) -> EvalDataset | None:
        row = self._conn.execute(
            f"SELECT dataset FROM {self._table('eval_datasets')} WHERE user_id = %s AND id = %s",
            (self._require_user(), dataset_id),
        ).fetchone()
        return EvalDataset.model_validate(row[0]) if row else None

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
            f"""
            INSERT INTO {self._table("eval_datasets")}
              (user_id, id, agent_id, name, dataset, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz)
            ON CONFLICT (user_id, id)
            DO UPDATE SET agent_id=EXCLUDED.agent_id, name=EXCLUDED.name,
              dataset=EXCLUDED.dataset, updated_at=EXCLUDED.updated_at
            """,
            (
                self._require_user(),
                row.id,
                row.agent_id,
                row.name,
                self._json(row.model_dump(by_alias=True, exclude_none=True)),
                row.created_at,
                row.updated_at,
            ),
        )
        return row

    def putDataset(self, dataset: EvalDataset | dict[str, Any]) -> EvalDataset:
        return self.put_dataset(dataset)

    def delete_dataset(self, dataset_id: str) -> None:
        self._conn.execute(
            f"DELETE FROM {self._table('eval_datasets')} WHERE user_id = %s AND id = %s",
            (self._require_user(), dataset_id),
        )

    def deleteDataset(self, dataset_id: str) -> None:
        self.delete_dataset(dataset_id)

    def put_eval_run(self, run: EvalRun | dict[str, Any]) -> EvalRun:
        normalized = EvalRun.model_validate(run)
        self._conn.execute(
            f"""
            INSERT INTO {self._table("eval_runs")}
              (user_id, id, eval_id, dataset_id, agent_id, agent_version,
               requested_agent_version, status, run, started_at, ended_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::timestamptz, %s::timestamptz)
            ON CONFLICT (user_id, id)
            DO UPDATE SET status=EXCLUDED.status, run=EXCLUDED.run, ended_at=EXCLUDED.ended_at
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
                self._json(normalized.model_dump(by_alias=True, exclude_none=True)),
                normalized.started_at,
                normalized.ended_at,
            ),
        )
        return normalized

    def putEvalRun(self, run: EvalRun | dict[str, Any]) -> EvalRun:
        return self.put_eval_run(run)

    def get_eval_run(self, run_id: str) -> EvalRun | None:
        row = self._conn.execute(
            f"SELECT run FROM {self._table('eval_runs')} WHERE user_id = %s AND id = %s",
            (self._require_user(), run_id),
        ).fetchone()
        return EvalRun.model_validate(row[0]) if row else None

    def getEvalRun(self, run_id: str) -> EvalRun | None:
        return self.get_eval_run(run_id)

    def list_eval_runs(self, **filters: Any) -> EvalRunListResult:
        rows = self._conn.execute(
            f"SELECT run FROM {self._table('eval_runs')} WHERE user_id = %s",
            (self._require_user(),),
        ).fetchall()
        return list_eval_runs_in_process(
            [EvalRun.model_validate(row[0]) for row in rows],
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
            f"""
            SELECT score FROM {self._table("eval_latest_scores")}
            WHERE user_id = %s AND eval_id = %s AND dataset_id = %s
              AND resolved_agent_version = %s
            """,
            (self._require_user(), eval_id, dataset_id, resolved_agent_version or ""),
        ).fetchone()
        return EvalLatestScore.model_validate(row[0]) if row else None

    def getEvalLatestScore(self, key: dict[str, Any]) -> EvalLatestScore | None:
        return self.get_eval_latest_score(
            eval_id=key["evalId"],
            dataset_id=key["datasetId"],
            resolved_agent_version=key.get("resolvedAgentVersion"),
        )

    def list_eval_latest_scores(self, **filters: Any) -> list[EvalLatestScore]:
        query = f"SELECT score FROM {self._table('eval_latest_scores')} WHERE user_id = %s"
        params: list[Any] = [self._require_user()]
        for snake, camel, column in [
            ("agent_id", "agentId", "agent_id"),
            ("eval_id", "evalId", "eval_id"),
            ("dataset_id", "datasetId", "dataset_id"),
            ("status", "status", "status"),
        ]:
            value = filters.get(snake) if snake in filters else filters.get(camel)
            if value is not None:
                query += f" AND {column} = %s"
                params.append(value)
        if "resolved_agent_version" in filters or "resolvedAgentVersion" in filters:
            query += " AND resolved_agent_version = %s"
            params.append(
                filters.get("resolved_agent_version", filters.get("resolvedAgentVersion"))
                or ""
            )
        query += " ORDER BY updated_at DESC, started_at DESC, run_id DESC"
        return [
            EvalLatestScore.model_validate(row[0])
            for row in self._conn.execute(query, params)
        ]

    def listEvalLatestScores(self, filters: dict[str, Any] | None = None) -> list[EvalLatestScore]:
        return self.list_eval_latest_scores(**(filters or {}))

    def put_eval_latest_score(self, score: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
        normalized = EvalLatestScore.model_validate(score)
        self._conn.execute(
            f"""
            INSERT INTO {self._table("eval_latest_scores")}
              (user_id, eval_id, dataset_id, agent_id, resolved_agent_version,
               requested_agent_version, run_id, status, overall_score, passed,
               score, started_at, ended_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s::timestamptz, %s::timestamptz, %s::timestamptz)
            ON CONFLICT (user_id, eval_id, dataset_id, resolved_agent_version)
            DO UPDATE SET agent_id=EXCLUDED.agent_id,
              requested_agent_version=EXCLUDED.requested_agent_version,
              run_id=EXCLUDED.run_id, status=EXCLUDED.status,
              overall_score=EXCLUDED.overall_score, passed=EXCLUDED.passed,
              score=EXCLUDED.score, started_at=EXCLUDED.started_at,
              ended_at=EXCLUDED.ended_at, updated_at=EXCLUDED.updated_at
            """,
            (
                self._require_user(),
                normalized.eval_id,
                normalized.dataset_id,
                normalized.agent_id,
                normalized.resolved_agent_version or "",
                normalized.requested_agent_version,
                normalized.run_id,
                normalized.status,
                normalized.overall_score,
                normalized.passed,
                self._json(normalized.model_dump(by_alias=True, exclude_none=True)),
                normalized.started_at,
                normalized.ended_at,
                normalized.updated_at,
            ),
        )
        return normalized

    def putEvalLatestScore(self, score: EvalLatestScore | dict[str, Any]) -> EvalLatestScore:
        return self.put_eval_latest_score(score)

    def put_run(self, run: LocalRunRecord) -> None:
        now = int(datetime.now(tz=UTC).timestamp() * 1000)
        self._conn.execute(
            f"""
            INSERT INTO {self._table("runs")}
              (user_id, id, root_id, agent_id, session_id, status, input,
               output, error, started_at, depth)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0)
            ON CONFLICT (user_id, id)
            DO UPDATE SET status=EXCLUDED.status, output=EXCLUDED.output, error=EXCLUDED.error
            """,
            (
                self._require_user(),
                run.id,
                run.root_id,
                run.agent_id,
                run.session_id,
                run.status,
                _json_text(run.input),
                _json_text(run.output),
                run.error,
                now,
            ),
        )

    def get_run(self, run_id: str) -> LocalRunRecord | None:
        row = self._conn.execute(
            f"""
            SELECT id, root_id, agent_id, session_id, status, input, output, error
            FROM {self._table("runs")}
            WHERE user_id = %s AND id = %s
            """,
            (self._require_user(), run_id),
        ).fetchone()
        return _row_to_run(row) if row else None

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]:
        query = f"""
            SELECT id, root_id, agent_id, session_id, status, input, output, error
            FROM {self._table("runs")}
            WHERE user_id = %s
        """
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND agent_id = %s"
            params.append(agent_id)
        if status is not None:
            query += " AND status = %s"
            params.append(status)
        query += " ORDER BY started_at ASC"
        return [_row_to_run(row) for row in self._conn.execute(query, params)]

    def put_trace(self, trace: LocalTraceRecord) -> None:
        self._conn.execute(
            f"""
            INSERT INTO {self._table("traces")}
              (user_id, trace_id, run_id, agent_id, session_id, status,
               started_at, ended_at, output, error)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, trace_id)
            DO UPDATE SET run_id=EXCLUDED.run_id,
              agent_id=EXCLUDED.agent_id,
              session_id=EXCLUDED.session_id,
              status=EXCLUDED.status,
              started_at=EXCLUDED.started_at,
              ended_at=EXCLUDED.ended_at,
              output=EXCLUDED.output,
              error=EXCLUDED.error
            """,
            (
                self._require_user(),
                trace.trace_id,
                trace.run_id,
                trace.agent_id,
                trace.session_id,
                trace.status,
                trace.started_at,
                trace.ended_at,
                self._json(trace.output),
                trace.error,
            ),
        )

    def get_trace(self, trace_id: str) -> LocalTraceRecord | None:
        row = self._conn.execute(
            f"""
            SELECT trace_id, run_id, agent_id, session_id, status,
                   started_at, ended_at, output, error
            FROM {self._table("traces")}
            WHERE user_id = %s AND trace_id = %s
            """,
            (self._require_user(), trace_id),
        ).fetchone()
        return _row_to_trace(row) if row else None

    def list_traces(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalTraceRecord]:
        query = f"""
            SELECT trace_id, run_id, agent_id, session_id, status,
                   started_at, ended_at, output, error
            FROM {self._table("traces")}
            WHERE user_id = %s
        """
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND agent_id = %s"
            params.append(agent_id)
        if status is not None:
            query += " AND status = %s"
            params.append(status)
        query += " ORDER BY started_at ASC, trace_id ASC"
        return [_row_to_trace(row) for row in self._conn.execute(query, params)]

    def put_trace_span(self, span: LocalTraceSpanRecord) -> None:
        self._conn.execute(
            f"""
            INSERT INTO {self._table("trace_spans")}
              (user_id, span_id, trace_id, parent_id, run_id, session_id,
               name, kind, started_at, ended_at, status, error, attributes,
               events, scores, cost_usd)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s)
            """,
            (
                self._require_user(),
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
                self._json(span.attributes or {}),
                self._json(span.events or []),
                self._json(span.scores or {}),
                span.cost_usd,
            ),
        )

    def list_trace_spans(self, trace_id: str) -> list[LocalTraceSpanRecord]:
        rows = self._conn.execute(
            f"""
            SELECT span_id, trace_id, parent_id, run_id, session_id, name,
                   kind, started_at, ended_at, status, error, attributes,
                   events, scores, cost_usd
            FROM {self._table("trace_spans")}
            WHERE user_id = %s AND trace_id = %s
            ORDER BY id ASC
            """,
            (self._require_user(), trace_id),
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
        user_id = self._require_user()
        existing = self._conn.execute(
            f"""
            SELECT created_at, agent_id
            FROM {self._table("sessions")}
            WHERE user_id = %s AND id = %s
            """,
            (user_id, session_id),
        ).fetchone()
        created_at = existing[0] if existing else messages[0].timestamp
        session_agent_id = agent_id or (existing[1] if existing else None)
        updated_at = messages[-1].timestamp
        with self._conn.transaction():
            self._conn.execute(
                f"""
                INSERT INTO {self._table("sessions")}
                  (user_id, id, agent_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (user_id, id)
                DO UPDATE SET agent_id=COALESCE(
                    EXCLUDED.agent_id,
                    {self._table("sessions")}.agent_id
                  ),
                  updated_at=EXCLUDED.updated_at
                """,
                (user_id, session_id, session_agent_id, created_at, updated_at),
            )
            for message in messages:
                self._conn.execute(
                    f"""
                    INSERT INTO {self._table("messages")}
                      (user_id, session_id, agent_id, role, content,
                       tool_calls, tool_call_id, timestamp)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        user_id,
                        message.session_id,
                        message.agent_id,
                        message.role,
                        self._json(message.content),
                        self._json(message.tool_calls),
                        message.tool_call_id,
                        message.timestamp,
                    ),
                )

    def get_messages(self, session_id: str) -> list[LocalMessageRecord]:
        rows = self._conn.execute(
            f"""
            SELECT session_id, agent_id, role, content, tool_calls, tool_call_id, timestamp
            FROM {self._table("messages")}
            WHERE user_id = %s AND session_id = %s
            ORDER BY id ASC
            """,
            (self._require_user(), session_id),
        ).fetchall()
        return [_row_to_message(row) for row in rows]

    def list_sessions(
        self,
        *,
        agent_id: str | None = None,
    ) -> list[LocalSessionSummary]:
        query = f"""
            SELECT s.id, s.agent_id, s.created_at, s.updated_at, COUNT(m.id) AS message_count
            FROM {self._table("sessions")} s
            LEFT JOIN {self._table("messages")} m
              ON m.user_id = s.user_id AND m.session_id = s.id
            WHERE s.user_id = %s
        """
        params: list[Any] = [self._require_user()]
        if agent_id is not None:
            query += " AND s.agent_id = %s"
            params.append(agent_id)
        query += " GROUP BY s.id, s.agent_id, s.created_at, s.updated_at ORDER BY s.updated_at DESC"
        rows = self._conn.execute(query, params).fetchall()
        return [_row_to_session(row) for row in rows]

    def delete_session(self, session_id: str) -> None:
        user_id = self._require_user()
        with self._conn.transaction():
            self._conn.execute(
                f"DELETE FROM {self._table('messages')} WHERE user_id = %s AND session_id = %s",
                (user_id, session_id),
            )
            self._conn.execute(
                f"DELETE FROM {self._table('sessions')} WHERE user_id = %s AND id = %s",
                (user_id, session_id),
            )

    def create_api_key(self, *, user_id: str, name: str) -> dict[str, Any]:
        raw_key = f"ar_live_{secrets.token_urlsafe(24)}"
        key_id = secrets.token_hex(16)
        now = self._next_timestamp()
        self._conn.execute(
            f"""
            INSERT INTO {self._table("api_keys")}
              (id, user_id, name, key_prefix, key_hash, created_at)
            VALUES (%s, %s, %s, %s, %s, %s::timestamptz)
            """,
            (key_id, user_id, name, raw_key[:12], _sha256(raw_key), now),
        )
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
            f"""
            SELECT id::text, user_id, name, key_prefix, created_at::text,
                   last_used_at::text, revoked_at::text
            FROM {self._table("api_keys")}
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [_row_to_api_key(row) for row in rows]

    def listApiKeys(self, user_id: str) -> list[ApiKeyRecord]:
        return self.list_api_keys(user_id)

    def revoke_api_key(self, *, user_id: str, key_id: str) -> None:
        self._conn.execute(
            f"""
            UPDATE {self._table("api_keys")}
            SET revoked_at = %s::timestamptz
            WHERE user_id = %s AND id::text = %s
            """,
            (self._next_timestamp(), user_id, key_id),
        )

    def revokeApiKey(self, params: dict[str, str]) -> None:
        self.revoke_api_key(user_id=params["userId"], key_id=params["keyId"])

    def resolve_api_key(self, raw_key: str) -> dict[str, str] | None:
        row = self._conn.execute(
            f"""
            SELECT id::text, user_id
            FROM {self._table("api_keys")}
            WHERE key_hash = %s AND revoked_at IS NULL
            """,
            (_sha256(raw_key),),
        ).fetchone()
        if row is None:
            return None
        self._conn.execute(
            f"UPDATE {self._table('api_keys')} SET last_used_at = NOW() WHERE id::text = %s",
            (row[0],),
        )
        return {"userId": row[1], "user_id": row[1], "keyId": row[0], "key_id": row[0]}

    def resolveApiKey(self, raw_key: str) -> dict[str, str] | None:
        return self.resolve_api_key(raw_key)

    def _migrate(self) -> None:
        jsonb = "JSONB"
        for statement in [
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("agents")} (
              user_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              name TEXT NOT NULL,
              description TEXT,
              definition {jsonb} NOT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              activated_at TIMESTAMPTZ,
              PRIMARY KEY (user_id, agent_id, created_at)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("agent_aliases")} (
              user_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              alias TEXT NOT NULL,
              version_created_at TIMESTAMPTZ NOT NULL,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              PRIMARY KEY (user_id, agent_id, alias)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("evals")} (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              name TEXT NOT NULL,
              definition {jsonb} NOT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL,
              PRIMARY KEY (user_id, id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("eval_datasets")} (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              agent_id TEXT,
              name TEXT NOT NULL,
              dataset {jsonb} NOT NULL,
              created_at TIMESTAMPTZ NOT NULL,
              updated_at TIMESTAMPTZ NOT NULL,
              PRIMARY KEY (user_id, id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("eval_runs")} (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              eval_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              agent_version TIMESTAMPTZ,
              requested_agent_version TEXT,
              status TEXT NOT NULL,
              run {jsonb} NOT NULL,
              started_at TIMESTAMPTZ NOT NULL,
              ended_at TIMESTAMPTZ,
              PRIMARY KEY (user_id, id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("eval_latest_scores")} (
              user_id TEXT NOT NULL,
              eval_id TEXT NOT NULL,
              dataset_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              resolved_agent_version TEXT NOT NULL,
              requested_agent_version TEXT,
              run_id TEXT NOT NULL,
              status TEXT NOT NULL,
              overall_score DOUBLE PRECISION NOT NULL,
              passed BOOLEAN NOT NULL,
              score {jsonb} NOT NULL,
              started_at TIMESTAMPTZ NOT NULL,
              ended_at TIMESTAMPTZ,
              updated_at TIMESTAMPTZ NOT NULL,
              PRIMARY KEY (user_id, eval_id, dataset_id, resolved_agent_version)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("runs")} (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              root_id TEXT NOT NULL,
              parent_id TEXT,
              agent_id TEXT NOT NULL,
              session_id TEXT,
              spawn_tool_use_id TEXT,
              status TEXT NOT NULL,
              input TEXT NOT NULL,
              output TEXT,
              result_json {jsonb},
              error TEXT,
              started_at BIGINT NOT NULL,
              ended_at BIGINT,
              depth INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (user_id, id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("traces")} (
              user_id TEXT NOT NULL,
              trace_id TEXT NOT NULL,
              run_id TEXT NOT NULL,
              agent_id TEXT NOT NULL,
              session_id TEXT NOT NULL,
              status TEXT NOT NULL,
              started_at DOUBLE PRECISION NOT NULL,
              ended_at DOUBLE PRECISION,
              output {jsonb},
              error TEXT,
              PRIMARY KEY (user_id, trace_id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("trace_spans")} (
              user_id TEXT NOT NULL,
              id BIGSERIAL PRIMARY KEY,
              span_id TEXT NOT NULL,
              trace_id TEXT NOT NULL,
              parent_id TEXT,
              run_id TEXT,
              session_id TEXT,
              name TEXT NOT NULL,
              kind TEXT NOT NULL,
              started_at DOUBLE PRECISION NOT NULL,
              ended_at DOUBLE PRECISION,
              status TEXT NOT NULL,
              error TEXT,
              attributes {jsonb} NOT NULL DEFAULT '{{}}'::jsonb,
              events {jsonb} NOT NULL DEFAULT '[]'::jsonb,
              scores {jsonb} NOT NULL DEFAULT '{{}}'::jsonb,
              cost_usd DOUBLE PRECISION
            )
            """,
            f"""
            CREATE INDEX IF NOT EXISTS {self._table("trace_spans_trace_idx")}
            ON {self._table("trace_spans")}(user_id, trace_id, id)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("sessions")} (
              user_id TEXT NOT NULL,
              id TEXT NOT NULL,
              agent_id TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (user_id, id)
            )
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("messages")} (
              user_id TEXT NOT NULL,
              id BIGSERIAL PRIMARY KEY,
              session_id TEXT NOT NULL,
              agent_id TEXT,
              role TEXT NOT NULL,
              content {jsonb} NOT NULL,
              tool_calls {jsonb},
              tool_call_id TEXT,
              timestamp TEXT NOT NULL
            )
            """,
            f"""
            CREATE INDEX IF NOT EXISTS {self._table("messages_session_idx")}
            ON {self._table("messages")}(user_id, session_id, id)
            """,
            f"""
            CREATE TABLE IF NOT EXISTS {self._table("api_keys")} (
              id UUID PRIMARY KEY,
              user_id TEXT NOT NULL,
              name TEXT NOT NULL,
              key_prefix TEXT NOT NULL,
              key_hash TEXT NOT NULL UNIQUE,
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              last_used_at TIMESTAMPTZ,
              revoked_at TIMESTAMPTZ
            )
            """,
        ]:
            self._conn.execute(statement)


def _import_psycopg() -> Any:
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            "PostgresStore requires the postgres extra: pip install 'agntz[postgres]'"
        ) from exc
    return psycopg


def _import_json() -> Any:
    from psycopg.types.json import Jsonb

    return Jsonb


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _json_text(value: Any) -> str:
    return json_dumps(value)


def json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, separators=(",", ":"), sort_keys=True, default=str)


def _json_loads(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    import json

    return json.loads(value)


def _row_to_run(row: Any) -> LocalRunRecord:
    return LocalRunRecord(
        id=row[0],
        root_id=row[1],
        agent_id=row[2],
        session_id=row[3],
        status=row[4],
        input=_json_loads(row[5]),
        output=_json_loads(row[6]),
        error=row[7],
    )


def _row_to_trace(row: Any) -> LocalTraceRecord:
    return LocalTraceRecord(
        trace_id=row[0],
        run_id=row[1],
        agent_id=row[2],
        session_id=row[3],
        status=row[4],
        started_at=float(row[5]),
        ended_at=float(row[6]) if row[6] is not None else None,
        output=_json_loads(row[7]),
        error=row[8],
    )


def _row_to_trace_span(row: Any) -> LocalTraceSpanRecord:
    return LocalTraceSpanRecord(
        span_id=row[0],
        trace_id=row[1],
        parent_id=row[2],
        run_id=row[3],
        session_id=row[4],
        name=row[5],
        kind=row[6],
        started_at=float(row[7]),
        ended_at=float(row[8]) if row[8] is not None else None,
        status=row[9],
        error=row[10],
        attributes=_json_loads(row[11]) or {},
        events=_json_loads(row[12]) or [],
        scores=_json_loads(row[13]) or {},
        cost_usd=float(row[14]) if row[14] is not None else None,
    )


def _row_to_message(row: Any) -> LocalMessageRecord:
    return LocalMessageRecord(
        session_id=row[0],
        agent_id=row[1],
        role=row[2],
        content=_json_loads(row[3]),
        tool_calls=_json_loads(row[4]),
        tool_call_id=row[5],
        timestamp=row[6],
    )


def _row_to_session(row: Any) -> LocalSessionSummary:
    return LocalSessionSummary(
        session_id=row[0],
        agent_id=row[1],
        created_at=row[2],
        updated_at=row[3],
        message_count=int(row[4]),
    )


def _row_to_api_key(row: Any) -> ApiKeyRecord:
    return ApiKeyRecord(
        id=row[0],
        userId=row[1],
        name=row[2],
        keyPrefix=row[3],
        createdAt=_pg_iso(row[4]),
        lastUsedAt=_pg_iso(row[5]) if row[5] else None,
        revokedAt=_pg_iso(row[6]) if row[6] else None,
    )


def _pg_iso(value: Any) -> str:
    if hasattr(value, "astimezone"):
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    text = str(value)
    if text.endswith("+00"):
        text = text[:-3] + "Z"
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    return text
