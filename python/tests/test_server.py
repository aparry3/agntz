from __future__ import annotations

import asyncio
import json
import textwrap
from typing import Any

import httpx
import pytest

from agntz import GenerateTextResult
from agntz.core import ModelMessage, ModelTool, ToolResult
from agntz.manifest import LLMAgentManifest
from agntz.manifest.types import AgentState
from agntz.server import create_app
from agntz.stores import MemoryStore


class ServerProvider:
    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
        messages: list[ModelMessage] | None = None,
        tools: list[ModelTool] | None = None,
        tool_results: list[ToolResult] | None = None,
    ) -> GenerateTextResult:
        if manifest.id.startswith("__agntz_eval_judge_"):
            assert prompt is not None
            assert '"actual": "{\\"ok\\":true}"' in prompt
            return GenerateTextResult(
                output=json.dumps(
                    {
                        "overallScore": 0.6,
                        "passed": False,
                        "criteria": {
                            "ok": {
                                "score": 0.6,
                                "passed": False,
                                "reason": "Not good enough.",
                            }
                        },
                        "reason": "Not good enough.",
                    }
                ),
                usage={"promptTokens": 4, "completionTokens": 3, "totalTokens": 7},
            )
        return GenerateTextResult(
            output={"ok": True},
            text='{"ok":true}',
            usage={"promptTokens": 2, "completionTokens": 1, "totalTokens": 3},
        )


@pytest.mark.asyncio
async def test_server_agent_run_eval_and_latest_score_flow() -> None:
    store = MemoryStore()
    key = store.create_api_key(user_id="u1", name="test")["rawKey"]
    app = create_app(store=store, internal_secret="secret", model_provider=ServerProvider())
    headers = {"authorization": f"Bearer {key}"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        manifest = textwrap.dedent(
            """
            id: support
            kind: llm
            model:
              provider: openai
              name: gpt-5.4
            instruction: Help.
            """
        )
        created = await client.post("/agents", headers=headers, json={"manifest": manifest})
        assert created.status_code == 201

        run = await client.post(
            "/run",
            headers=headers,
            json={"agentId": "support", "input": "hello"},
        )
        assert run.status_code == 200
        assert run.json()["output"] == {"ok": True}

        dataset = await client.post(
            "/datasets",
            headers=headers,
            json={
                "agentId": "support",
                "name": "d",
                "items": [{"input": "hello"}],
            },
        )
        definition = await client.post(
            "/evals",
            headers=headers,
            json={
                "agentId": "support",
                "name": "e",
                "defaultDatasetId": dataset.json()["id"],
                "criteria": [{"id": "ok", "name": "OK"}],
            },
        )
        started = await client.post(
            "/eval-runs",
            headers=headers,
            json={"evalId": definition.json()["id"]},
        )
        assert started.status_code == 201
        completed = await _poll_eval_run(client, headers, started.json()["id"])
        assert completed["summary"]["overallScore"] == 0.6
        assert completed["summary"]["passed"] is False
        assert completed["caseResults"][0]["agentRunId"]
        assert completed["caseResults"][0]["invocationId"]
        assert completed["caseResults"][0]["usage"] == {
            "promptTokens": 2,
            "completionTokens": 1,
            "totalTokens": 3,
        }

        latest = await client.get(
            "/eval-scores/latest",
            headers=headers,
            params={
                "evalId": definition.json()["id"],
                "datasetId": dataset.json()["id"],
                "resolvedAgentVersion": completed["agentVersion"],
            },
        )
        assert latest.status_code == 200
        assert latest.json()["runId"] == completed["id"]

        missing_run = await client.post(
            "/eval-runs",
            headers=headers,
            json={"evalId": "missing_eval"},
        )
        assert missing_run.status_code == 404

        other_dataset = await client.post(
            "/datasets",
            headers=headers,
            json={
                "agentId": "other-agent",
                "name": "other",
                "items": [{"input": "hello"}],
            },
        )
        cross_agent = await client.post(
            "/evals",
            headers=headers,
            json={
                "agentId": "support",
                "name": "bad",
                "defaultDatasetId": other_dataset.json()["id"],
                "criteria": [{"id": "ok", "name": "OK"}],
            },
        )
        assert cross_agent.status_code == 400


async def _poll_eval_run(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    run_id: str,
) -> dict[str, Any]:
    for _ in range(10):
        await asyncio.sleep(0.01)
        response = await client.get(f"/eval-runs/{run_id}", headers=headers)
        body = response.json()
        if body["status"] != "running":
            return body
    raise AssertionError("eval run did not finish")
