from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from agntz import AgntzClient, AsyncAgntzClient, AuthenticationError, NotFoundError, StreamError


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _run_payload() -> dict[str, Any]:
    return {
        "output": {"answer": "done"},
        "state": {"support": {"answer": "done"}},
        "sessionId": "sess_abc",
        "replies": [
            {
                "text": "Working on it",
                "ts": "2026-05-24T00:00:00.000Z",
                "sessionId": "sess_abc",
                "runId": "run_abc",
            }
        ],
    }


def test_agents_run_sends_hosted_wire_request() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.method == "POST"
        assert request.url.path == "/run"
        assert request.headers["authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "agentId": "support",
            "input": "hello",
            "sessionId": "sess_abc",
        }
        return httpx.Response(200, json=_run_payload())

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    result = client.agents.run(agent_id="support", input="hello", session_id="sess_abc")

    assert len(seen) == 1
    assert result.output == {"answer": "done"}
    assert result.session_id == "sess_abc"
    assert result.model_dump(by_alias=True)["sessionId"] == "sess_abc"
    assert result.replies is not None
    assert result.replies[0].run_id == "run_abc"


def test_agents_run_sends_runtime_context() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/run"
        assert json.loads(request.content) == {
            "agentId": "support",
            "input": "hello",
            "sessionId": "sess_abc",
            "context": ["app/user/u_123"],
        }
        return httpx.Response(200, json=_run_payload())

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    result = client.agents.run(
        agent_id="support",
        input="hello",
        session_id="sess_abc",
        context=["app/user/u_123"],
    )

    assert result.output == {"answer": "done"}


@pytest.mark.asyncio
async def test_async_agents_run_sends_hosted_wire_request() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/run"
        assert json.loads(request.content) == {"agentId": "support", "input": "hello"}
        return httpx.Response(200, json=_run_payload())

    async with AsyncAgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        result = await client.agents.run(agent_id="support", input="hello")

    assert result.output == {"answer": "done"}
    assert result.session_id == "sess_abc"


def test_agents_stream_normalizes_sse_events() -> None:
    body = (
        _sse(
            "run-start",
            {"agentId": "support", "kind": "llm", "sessionId": "sess_abc"},
        )
        + _sse(
            "reply",
            {
                "text": "Working on it",
                "ts": "2026-05-24T00:00:00.000Z",
                "sessionId": "sess_abc",
                "runId": "run_abc",
                "seq": 1,
            },
        )
        + _sse(
            "run-complete",
            {"output": "done", "state": {"support": "done"}, "sessionId": "sess_abc"},
        )
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/run/stream"
        assert request.headers["accept"] == "text/event-stream"
        return httpx.Response(
            200,
            content=body.encode(),
            headers={"content-type": "text/event-stream"},
        )

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    events = list(client.agents.stream(agent_id="support", input="hello"))

    assert [event.type for event in events] == ["start", "reply", "complete"]
    assert events[0].agent_id == "support"
    assert events[1].run_id == "run_abc"
    assert events[2].output == "done"


def test_agents_stream_raises_on_truncated_stream() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse(
                "run-start",
                {"agentId": "support", "kind": "llm", "sessionId": "sess_abc"},
            ).encode(),
            headers={"content-type": "text/event-stream"},
        )

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(StreamError, match="before completion"):
        list(client.agents.stream(agent_id="support"))


def test_http_errors_map_to_client_errors() -> None:
    statuses: Iterator[int] = iter([401, 404, 500])

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(next(statuses), json={"error": "nope"})

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    with pytest.raises(AuthenticationError):
        client.agents.run(agent_id="support")
    with pytest.raises(NotFoundError):
        client.agents.run(agent_id="support")
    with pytest.raises(Exception, match="nope"):
        client.agents.run(agent_id="support")


def test_runs_and_traces_resources_use_expected_paths() -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(str(request.url))
        if request.url.path == "/runs":
            return httpx.Response(200, json={"rows": []})
        if request.url.path == "/traces":
            return httpx.Response(200, json={"rows": []})
        if request.url.path.endswith("/cancel"):
            return httpx.Response(200, json=_run_record("cancelled"))
        if request.url.path == "/runs/run_abc":
            return httpx.Response(200, json=_run_record("running"))
        if request.url.path == "/traces/trace_abc":
            return httpx.Response(200, json={"summary": _trace_summary(), "spans": []})
        return httpx.Response(500, json={"error": "unexpected path"})

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert client.runs.list(roots_only=True, limit=5).rows == []
    assert client.traces.list(agent_id="support").rows == []
    assert client.runs.get("run_abc").status == "running"
    assert client.runs.cancel("run_abc").status == "cancelled"
    assert client.traces.get("trace_abc").summary.trace_id == "trace_abc"

    assert paths[:2] == [
        "https://worker.test/runs?rootsOnly=true&limit=5",
        "https://worker.test/traces?agentId=support",
    ]


def test_agent_version_dataset_and_eval_resources_use_expected_paths() -> None:
    seen: list[tuple[str, str, Any]] = []
    agent = {
        "id": "support",
        "name": "Support",
        "systemPrompt": "Help.",
        "model": {"provider": "openai", "name": "gpt-5.4"},
    }
    dataset = {
        "id": "dataset_1",
        "agentId": "support",
        "name": "Dataset",
        "items": [{"id": "case_1", "input": "hello"}],
    }
    definition = {
        "id": "eval_1",
        "agentId": "support",
        "name": "Eval",
        "defaultDatasetId": "dataset_1",
        "criteria": [{"id": "ok", "name": "OK"}],
    }
    run = {
        "id": "evalrun_1",
        "evalId": "eval_1",
        "datasetId": "dataset_1",
        "agentId": "support",
        "agentVersion": "v1",
        "status": "running",
        "startedAt": "2026-06-05T12:00:00.000Z",
        "snapshots": {"eval": definition, "dataset": dataset, "agent": agent},
        "caseResults": [],
    }
    score = {
        "evalId": "eval_1",
        "datasetId": "dataset_1",
        "agentId": "support",
        "resolvedAgentVersion": "v1",
        "runId": "evalrun_1",
        "status": "completed",
        "overallScore": 1,
        "passed": True,
        "startedAt": "2026-06-05T12:00:00.000Z",
        "updatedAt": "2026-06-05T12:00:01.000Z",
    }

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        seen.append((request.method, str(request.url), body))
        path = request.url.path
        if path == "/agents/support/versions":
            return httpx.Response(200, json=[{"createdAt": "v1", "aliases": []}])
        if path == "/agents/support/versions/v1":
            return httpx.Response(200, json=agent)
        if path == "/agents/support/versions/v1/activate":
            return httpx.Response(204)
        if path == "/agents/support/aliases/stable":
            return httpx.Response(200, json={"agentId": "support", "alias": "stable"})
        if path == "/datasets":
            return httpx.Response(200, json=[dataset] if request.method == "GET" else dataset)
        if path == "/datasets/dataset_1":
            return httpx.Response(200, json=dataset)
        if path == "/evals":
            return httpx.Response(200, json=[definition] if request.method == "GET" else definition)
        if path == "/evals/eval_1":
            return httpx.Response(200, json=definition)
        if path == "/eval-runs":
            return httpx.Response(200, json={"rows": [run]} if request.method == "GET" else run)
        if path == "/eval-runs/evalrun_1":
            return httpx.Response(200, json=run)
        if path == "/eval-runs/evalrun_1/cancel":
            return httpx.Response(200, json={**run, "status": "cancelled"})
        if path == "/eval-scores/latest":
            return httpx.Response(200, json=score)
        if path == "/eval-scores":
            return httpx.Response(200, json=[score])
        return httpx.Response(500, json={"error": f"unexpected path: {path}"})

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert client.agents.list_versions("support")[0].created_at == "v1"
    assert client.agents.get_version("support", "v1").id == "support"
    client.agents.activate_version("support", "v1")
    assert client.agents.set_alias("support", "stable", "v1")["alias"] == "stable"
    assert client.datasets.list(agent_id="support")[0].id == "dataset_1"
    assert client.datasets.create(agent_id="support", name="Dataset", items=[]).id == "dataset_1"
    assert client.datasets.get("dataset_1").id == "dataset_1"
    assert client.evals.list(agent_id="support")[0].id == "eval_1"
    assert client.evals.create(definition).id == "eval_1"
    assert client.evals.get("eval_1").id == "eval_1"
    assert client.evals.run(eval_id="eval_1", dataset_id="dataset_1", agent_version="v1").id
    assert client.evals.get_run("evalrun_1").id == "evalrun_1"
    assert client.evals.cancel_run("evalrun_1").status == "cancelled"
    assert client.evals.list_runs(agent_id="support", limit=5).rows[0].id == "evalrun_1"
    latest = client.evals.get_latest_score(
        eval_id="eval_1",
        dataset_id="dataset_1",
        resolved_agent_version="v1",
    )
    assert latest is not None
    assert latest.run_id == "evalrun_1"
    assert client.evals.list_latest_scores(agent_id="support")[0].run_id == "evalrun_1"

    assert seen[0] == (
        "GET",
        "https://worker.test/agents/support/versions",
        {},
    )
    assert seen[4] == (
        "GET",
        "https://worker.test/datasets?agentId=support",
        {},
    )
    assert seen[10] == (
        "POST",
        "https://worker.test/eval-runs",
        {"evalId": "eval_1", "datasetId": "dataset_1", "agentVersion": "v1"},
    )


def test_run_stream_and_trace_stream_stop_on_terminal_events() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/runs/run_abc/stream":
            return httpx.Response(
                200,
                content=_sse(
                    "run-complete",
                    {"type": "run-complete", "runId": "run_abc", "seq": 1},
                ).encode(),
                headers={"content-type": "text/event-stream"},
            )
        if request.url.path == "/traces/trace_abc/stream":
            return httpx.Response(
                200,
                content=_sse("trace-done", {"summary": _trace_summary()}).encode(),
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(500, json={"error": "unexpected path"})

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    assert [event.type for event in client.runs.stream(run_id="run_abc")] == ["run-complete"]
    assert [event.type for event in client.traces.stream("trace_abc")] == ["trace-done"]


def _run_record(status: str) -> dict[str, Any]:
    return {
        "id": "run_abc",
        "rootId": "run_abc",
        "agentId": "support",
        "status": status,
        "input": "hello",
        "startedAt": 1,
        "depth": 0,
    }


def _trace_summary() -> dict[str, Any]:
    return {
        "traceId": "trace_abc",
        "ownerId": "user_abc",
        "rootName": "support",
        "agentId": "support",
        "startedAt": "2026-05-24T00:00:00.000Z",
        "endedAt": None,
        "durationMs": None,
        "spanCount": 0,
        "status": "ok",
        "totalTokens": 0,
        "totalCostUsd": None,
    }
