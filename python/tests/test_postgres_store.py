from __future__ import annotations

import os
from time import time_ns

import pytest

from agntz.client.models import EvalRun
from agntz.evals import latest_score_from_eval_run
from agntz.stores.memory import (
    LocalMessageRecord,
    LocalRunRecord,
    LocalTraceRecord,
    LocalTraceSpanRecord,
)

POSTGRES_URL = os.environ.get("DATABASE_URL")

if POSTGRES_URL:
    pytest.importorskip("psycopg")

pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="set DATABASE_URL to run PostgresStore tests",
)


def test_postgres_store_persists_hosted_service_surfaces() -> None:
    from agntz.stores.postgres import PostgresStore

    store = PostgresStore(
        POSTGRES_URL or "",
        user_id="u1",
        table_prefix=f"test_agntz_{time_ns()}_",
    )
    other_user = store.for_user("u2")
    now = "2026-06-05T12:00:00.000Z"

    try:
        key = store.create_api_key(user_id="u1", name="ci")["rawKey"]
        assert store.resolve_api_key(key) == {
            "userId": "u1",
            "user_id": "u1",
            "keyId": store.list_api_keys("u1")[0].id,
            "key_id": store.list_api_keys("u1")[0].id,
        }

        first = store.put_agent(
            {
                "id": "support",
                "name": "Support",
                "systemPrompt": "Help.",
                "model": {"provider": "openai", "name": "gpt-5.4"},
            }
        )
        second = store.put_agent(
            {
                "id": "support",
                "name": "Support",
                "systemPrompt": "Help more.",
                "model": {"provider": "openai", "name": "gpt-5.4"},
            }
        )
        versions = store.list_agent_versions("support")
        assert [version.created_at for version in versions] == [
            second.created_at,
            first.created_at,
        ]
        store.set_agent_version_alias("support", second.created_at or "", "stable")
        assert store.resolve_agent_alias("support", "stable") == second.created_at
        assert store.get_agent_version("support", second.created_at or "") == second
        assert other_user.get_agent("support") is None

        store.put_run(
            LocalRunRecord(
                id="run_1",
                root_id="run_1",
                agent_id="support",
                session_id="session_1",
                status="completed",
                input={"q": "hello"},
                output={"ok": True},
            )
        )
        assert store.get_run("run_1") is not None
        assert store.list_runs(agent_id="support")[0].output == {"ok": True}

        store.put_trace(
            LocalTraceRecord(
                trace_id="trace_1",
                run_id="run_1",
                agent_id="support",
                session_id="session_1",
                status="ok",
                started_at=1.0,
                ended_at=1.25,
                output={"ok": True},
            )
        )
        store.put_trace_span(
            LocalTraceSpanRecord(
                span_id="span_1",
                trace_id="trace_1",
                parent_id=None,
                run_id="run_1",
                session_id="session_1",
                name="support",
                kind="model",
                started_at=1.0,
                ended_at=1.25,
                status="ok",
                attributes={"tokens": 12},
            )
        )
        assert store.get_trace("trace_1") is not None
        assert store.list_trace_spans("trace_1")[0].attributes == {"tokens": 12}

        store.append_messages(
            "session_1",
            [
                LocalMessageRecord(
                    session_id="session_1",
                    agent_id="support",
                    role="user",
                    content="hello",
                    timestamp=now,
                ),
                LocalMessageRecord(
                    session_id="session_1",
                    agent_id="support",
                    role="assistant",
                    content=[{"type": "text", "text": "hi"}],
                    timestamp=now,
                ),
            ],
            agent_id="support",
        )
        assert [message.role for message in store.get_messages("session_1")] == [
            "user",
            "assistant",
        ]
        assert store.list_sessions(agent_id="support")[0].message_count == 2

        dataset = store.put_dataset(
            {
                "id": "dataset_1",
                "agentId": "support",
                "name": "Dataset",
                "items": [{"id": "case_1", "input": "hello"}],
            }
        )
        definition = store.put_eval(
            {
                "id": "eval_1",
                "agentId": "support",
                "name": "Eval",
                "defaultDatasetId": dataset.id,
                "criteria": [{"id": "ok", "name": "OK"}],
            }
        )
        summary = {
            "totalCases": 1,
            "completedCases": 1,
            "failedCases": 0,
            "skippedCases": 0,
            "overallScore": 1,
            "passed": True,
            "criteria": {},
        }
        eval_run = EvalRun.model_validate(
            {
                "id": "evalrun_1",
                "evalId": definition.id,
                "datasetId": dataset.id,
                "agentId": "support",
                "agentVersion": second.created_at,
                "status": "completed",
                "startedAt": now,
                "endedAt": now,
                "snapshots": {
                    "eval": definition.model_dump(by_alias=True, exclude_none=True),
                    "dataset": dataset.model_dump(by_alias=True, exclude_none=True),
                    "agent": second.model_dump(by_alias=True, exclude_none=True),
                    "agentVersion": second.created_at,
                },
                "caseResults": [],
                "summary": summary,
            }
        )
        store.put_eval_run(eval_run)
        store.put_eval_latest_score(latest_score_from_eval_run(eval_run))
        assert store.get_eval_run("evalrun_1") == eval_run
        latest = store.get_eval_latest_score(
            eval_id=definition.id,
            dataset_id=dataset.id,
            resolved_agent_version=second.created_at,
        )
        assert latest is not None
        assert latest.run_id == "evalrun_1"

        replacement = eval_run.model_copy(update={"id": "evalrun_2"})
        store.put_eval_run(replacement)
        store.put_eval_latest_score(latest_score_from_eval_run(replacement))
        scores = store.list_eval_latest_scores(agent_id="support")
        assert len(scores) == 1
        assert scores[0].run_id == "evalrun_2"
    finally:
        other_user.close()
        store.close()
