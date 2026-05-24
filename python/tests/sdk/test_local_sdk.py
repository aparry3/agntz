from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel

from agntz import GenerateTextResult, LiteLLMModelProvider, agntz, tool
from agntz.core import format_litellm_model
from agntz.manifest import LLMAgentManifest
from agntz.manifest.types import AgentState

ROOT = Path(__file__).resolve().parents[3]
MANIFESTS = ROOT / "contracts" / "python-port" / "manifests"


class FakeProvider:
    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> GenerateTextResult:
        if manifest.id == "support":
            return GenerateTextResult(
                output='{"answer":"Use the refund workflow.","confidence":0.82}',
                text='{"answer":"Use the refund workflow.","confidence":0.82}',
            )
        if manifest.id == "summarizer":
            return GenerateTextResult(output="Use the refund workflow.")
        if manifest.id == "tone-reviewer":
            return GenerateTextResult(output="clear")
        return GenerateTextResult(output=f"output:{manifest.id}")


class AddInput(BaseModel):
    a: float
    b: float


def _copy_agents(tmp_path: Path) -> Path:
    target = tmp_path / "agents"
    target.mkdir()
    for path in MANIFESTS.glob("*.yaml"):
        shutil.copy(path, target / path.name)
    return target


def test_local_sdk_runs_llm_and_records_run(tmp_path: Path) -> None:
    client = agntz(agents=str(_copy_agents(tmp_path)), model_provider=FakeProvider())

    result = client.agents.run(agent_id="support", input={"userQuery": "Refund request"})

    assert result.output == {"answer": "Use the refund workflow.", "confidence": 0.82}
    assert result.session_id.startswith("sess_")
    rows = client.runs.list(agent_id="support", status="completed")
    assert len(rows) == 1
    assert rows[0].id.startswith("run_")
    assert rows[0].output == result.output


def test_local_sdk_runs_registered_pydantic_tool(tmp_path: Path) -> None:
    def add(args: AddInput) -> dict[str, Any]:
        return {"result": args.a + args.b}

    add_tool = tool(
        name="add",
        description="Add two numbers",
        input_schema=AddInput,
        execute=add,
    )
    client = agntz(
        agents=str(_copy_agents(tmp_path)),
        tools=[add_tool],
        model_provider=FakeProvider(),
    )

    result = client.agents.run(agent_id="calculator", input={"a": 2, "b": 3})

    assert result.output == {"result": 5.0}


def test_local_sdk_runs_pipeline_and_streams_terminal_events(tmp_path: Path) -> None:
    client = agntz(agents=str(_copy_agents(tmp_path)), model_provider=FakeProvider())

    result = client.agents.run(agent_id="support-flow", input={"userQuery": "Refund request"})
    events = list(
        client.agents.stream(agent_id="review-pack", input={"userQuery": "Refund request"})
    )

    assert result.output == {"answer": "Use the refund workflow.", "confidence": 0.82}
    assert [event.type for event in events] == ["start", "complete"]
    assert events[0].agent_id == "review-pack"
    assert events[1].output == {"support": "Use the refund workflow.", "tone": "clear"}


def test_local_sdk_arun_inside_event_loop(tmp_path: Path) -> None:
    client = agntz(agents=str(_copy_agents(tmp_path)), model_provider=FakeProvider())

    async def run() -> str:
        result = await client.agents.arun(
            agent_id="support",
            input={"userQuery": "Refund request"},
        )
        return result.session_id

    import asyncio

    assert asyncio.run(run()).startswith("sess_")


def test_local_sdk_invokes_http_tool(tmp_path: Path) -> None:
    agents_dir = _copy_agents(tmp_path)
    (agents_dir / "http-weather.yaml").write_text(
        """
id: weather
kind: tool
tool:
  kind: http
  name: weather
  url: https://api.example.test/weather/{city}
  method: POST
  headers:
    X-Api-Key: "{{apiKey}}"
  params:
    city: "{{city}}"
  body_type: json
  body:
    units: "{{units}}"
inputSchema:
  city: string
  units: string
  apiKey: string
""",
        encoding="utf-8",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/weather/Detroit"
        assert request.headers["x-api-key"] == "secret"
        assert json.loads(request.read()) == {"units": "imperial"}
        return httpx.Response(200, json={"temp": 72})

    client = agntz(
        agents=str(agents_dir),
        model_provider=FakeProvider(),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    result = client.agents.run(
        agent_id="weather",
        input={"city": "Detroit", "units": "imperial", "apiKey": "secret"},
    )

    assert result.output == {"temp": 72}


def test_litellm_provider_model_slug_mapping() -> None:
    assert isinstance(LiteLLMModelProvider(), LiteLLMModelProvider)
    assert format_litellm_model("openai", "gpt-5.4") == "gpt-5.4"
    assert format_litellm_model("google", "gemini-3.5-flash") == "gemini/gemini-3.5-flash"
    assert format_litellm_model("openrouter", "openai/gpt-5.4") == "openrouter/openai/gpt-5.4"
    assert format_litellm_model("anthropic", "claude-sonnet-4.5") == (
        "anthropic/claude-sonnet-4.5"
    )
