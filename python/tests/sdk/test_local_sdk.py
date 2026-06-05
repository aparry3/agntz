from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import BaseModel

from agntz import (
    GenerateTextResult,
    LiteLLMModelProvider,
    ModelMessage,
    ModelTool,
    NamespaceGrantError,
    SQLiteStore,
    ToolCall,
    ToolResult,
    agntz,
    tool,
)
from agntz.core import format_litellm_model
from agntz.core.litellm_provider import _usage_from_litellm
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
        messages: list[ModelMessage] | None = None,
        tools: list[ModelTool] | None = None,
        tool_results: list[ToolResult] | None = None,
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


class ToolCallingProvider:
    def __init__(self) -> None:
        self.calls: list[
            tuple[
                list[ModelTool] | None,
                list[ToolResult] | None,
                list[ModelMessage] | None,
            ]
        ] = []

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
        self.calls.append((tools, tool_results, list(messages or [])))
        if not tool_results:
            raw_tool_call = {
                "id": "call_1",
                "type": "function",
                "function": {"name": "add", "arguments": '{"a":2,"b":3}'},
            }
            return GenerateTextResult(
                output="",
                tool_calls=[ToolCall(id="call_1", name="add", input={"a": 2, "b": 3})],
                response_messages=[
                    ModelMessage(role="assistant", content="", tool_calls=[raw_tool_call])
                ],
            )
        return GenerateTextResult(output={"answer": tool_results[0].output["result"]})


class ResponseReplayProvider:
    def __init__(self) -> None:
        self.messages: list[list[ModelMessage]] = []

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
        self.messages.append(list(messages or []))
        if not tool_results:
            return GenerateTextResult(
                output="",
                tool_calls=[ToolCall(id="call_1", name="add", input={"a": 2, "b": 3})],
                response_messages=[
                    ModelMessage(
                        role="assistant",
                        content=[
                            {
                                "type": "reasoning",
                                "providerOptions": {"openai": {"itemId": "rs_123"}},
                            },
                            {
                                "type": "tool-call",
                                "toolCallId": "call_1",
                                "toolName": "add",
                                "input": {"a": 2, "b": 3},
                                "providerOptions": {"openai": {"itemId": "fc_123"}},
                            },
                        ],
                    )
                ],
            )
        return GenerateTextResult(output={"answer": tool_results[0].output["result"]})


class CrossProviderSessionProvider:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, list[ModelMessage]]] = []

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
        self.calls.append((manifest.id, manifest.model.provider, list(messages or [])))
        if manifest.id == "gemini-tool-user" and not tool_results:
            return GenerateTextResult(
                output="",
                tool_calls=[ToolCall(id="call_1", name="add", input={"a": 2, "b": 3})],
                response_messages=[
                    ModelMessage(
                        role="assistant",
                        content=[
                            {
                                "type": "reasoning",
                                "providerOptions": {
                                    "google": {"thoughtSignature": "sig-google-123"}
                                },
                            },
                            {
                                "type": "tool-call",
                                "toolCallId": "call_1",
                                "toolName": "add",
                                "input": {"a": 2, "b": 3},
                                "providerOptions": {
                                    "google": {"thoughtSignature": "sig-google-123"}
                                },
                            },
                        ],
                    )
                ],
            )
        if manifest.id == "gemini-tool-user":
            return GenerateTextResult(output="Gemini answered with 5.")
        return GenerateTextResult(output="GPT answered the follow-up.")


class SessionAwareProvider:
    def __init__(self) -> None:
        self.messages: list[list[ModelMessage]] = []

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
        self.messages.append(list(messages or []))
        return GenerateTextResult(output=f"turn {len(self.messages)}")


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
    traces = client.traces.list(agent_id="support", status="ok")
    assert len(traces["rows"]) == 1
    trace_id = traces["rows"][0]["traceId"]
    detail = client.traces.get(trace_id)
    assert detail is not None
    assert detail["summary"]["agentId"] == "support"
    assert detail["summary"]["spanCount"] == len(detail["spans"])
    assert detail["spans"][0]["runId"] == rows[0].id
    assert any(span["kind"] == "model" and span["name"] == "support" for span in detail["spans"])
    events = list(client.traces.stream(trace_id))
    assert [event.type for event in events] == ["snapshot"]
    assert events[0].summary is not None
    assert events[0].summary["traceId"] == trace_id


def test_local_sdk_records_sessions_and_replays_history(tmp_path: Path) -> None:
    provider = SessionAwareProvider()
    client = agntz(agents=str(_copy_agents(tmp_path)), model_provider=provider)

    first = client.agents.run(
        agent_id="support",
        input={"userQuery": "first"},
        session_id="customer-1",
    )
    second = client.agents.run(
        agent_id="support",
        input={"userQuery": "second"},
        session_id=first.session_id,
    )

    assert second.session_id == "customer-1"
    assert [message.role for message in provider.messages[0]] == ["user"]
    assert [message.role for message in provider.messages[1]] == [
        "user",
        "assistant",
        "user",
    ]
    assert provider.messages[1][0].content == '{"userQuery":"first"}'
    assert provider.messages[1][1].content == "turn 1"
    assert provider.messages[1][2].content == '{"userQuery":"second"}'
    messages = client.sessions.get_messages("customer-1")
    assert [(message.role, message.content) for message in messages] == [
        ("user", '{"userQuery":"first"}'),
        ("assistant", "turn 1"),
        ("user", '{"userQuery":"second"}'),
        ("assistant", "turn 2"),
    ]
    sessions = client.sessions.list(agent_id="support")
    assert len(sessions) == 1
    assert sessions[0].session_id == "customer-1"
    assert sessions[0].message_count == 4
    client.sessions.delete("customer-1")
    assert client.sessions.get_messages("customer-1") == []


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


def test_local_sdk_executes_llm_tool_calls(tmp_path: Path) -> None:
    agents_dir = _copy_agents(tmp_path)
    (agents_dir / "tool-user.yaml").write_text(
        """
id: tool-user
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: Use the add tool.
tools:
  - kind: local
    tools: [add]
""",
        encoding="utf-8",
    )

    def add(args: AddInput) -> dict[str, Any]:
        return {"result": args.a + args.b}

    provider = ToolCallingProvider()
    client = agntz(
        agents=str(agents_dir),
        tools=[
            tool(
                name="add",
                description="Add two numbers",
                input_schema=AddInput,
                execute=add,
            )
        ],
        model_provider=provider,
    )

    result = client.agents.run(agent_id="tool-user", input="add two numbers")

    assert result.output == {"answer": 5.0}
    assert provider.calls[0][0] is not None
    assert provider.calls[0][0][0].name == "add"
    assert provider.calls[1][1] is not None
    assert provider.calls[1][1][0].output == {"result": 5.0}
    assert provider.calls[1][2] is not None
    assert [message.role for message in provider.calls[1][2]] == [
        "user",
        "assistant",
        "tool",
    ]
    assert provider.calls[1][2][1].tool_calls == [
        {
            "id": "call_1",
            "type": "function",
            "function": {"name": "add", "arguments": '{"a":2,"b":3}'},
        }
    ]
    assert provider.calls[1][2][2].tool_call_id == "call_1"
    assert provider.calls[1][2][2].content == '{"result":5.0}'
    traces = client.traces.list(agent_id="tool-user", status="ok")
    trace_id = traces["rows"][0]["traceId"]
    detail = client.traces.get(trace_id)
    assert detail is not None
    assert [span["kind"] for span in detail["spans"]] == [
        "run",
        "model",
        "tool",
        "model",
    ]


def test_local_sdk_replays_provider_response_messages_for_tool_followup(
    tmp_path: Path,
) -> None:
    agents_dir = _copy_agents(tmp_path)
    (agents_dir / "tool-user.yaml").write_text(
        """
id: tool-user
kind: llm
model:
  provider: openai
  name: gpt-5.5
instruction: Use the add tool.
tools:
  - kind: local
    tools: [add]
""",
        encoding="utf-8",
    )

    def add(args: AddInput) -> dict[str, Any]:
        return {"result": args.a + args.b}

    provider = ResponseReplayProvider()
    client = agntz(
        agents=str(agents_dir),
        tools=[
            tool(
                name="add",
                description="Add two numbers",
                input_schema=AddInput,
                execute=add,
            )
        ],
        model_provider=provider,
    )

    result = client.agents.run(agent_id="tool-user", input="add two numbers")

    assert result.output == {"answer": 5.0}
    assert len(provider.messages) == 2
    assert [message.role for message in provider.messages[1]] == [
        "user",
        "assistant",
        "tool",
    ]
    assert provider.messages[1][1].content == [
        {
            "type": "reasoning",
            "providerOptions": {"openai": {"itemId": "rs_123"}},
        },
        {
            "type": "tool-call",
            "toolCallId": "call_1",
            "toolName": "add",
            "input": {"a": 2, "b": 3},
            "providerOptions": {"openai": {"itemId": "fc_123"}},
        },
    ]
    assert provider.messages[1][2].role == "tool"
    assert provider.messages[1][2].tool_call_id == "call_1"


def test_local_sdk_keeps_shared_session_history_portable_across_providers(
    tmp_path: Path,
) -> None:
    agents_dir = _copy_agents(tmp_path)
    (agents_dir / "gemini-tool-user.yaml").write_text(
        """
id: gemini-tool-user
kind: llm
model:
  provider: google
  name: gemini-3.5-flash
instruction: Use the add tool.
tools:
  - kind: local
    tools: [add]
""",
        encoding="utf-8",
    )
    (agents_dir / "gpt-followup.yaml").write_text(
        """
id: gpt-followup
kind: llm
model:
  provider: openai
  name: gpt-5.5
instruction: Answer follow-up questions.
""",
        encoding="utf-8",
    )

    def add(args: AddInput) -> dict[str, Any]:
        return {"result": args.a + args.b}

    provider = CrossProviderSessionProvider()
    client = agntz(
        agents=str(agents_dir),
        tools=[
            tool(
                name="add",
                description="Add two numbers",
                input_schema=AddInput,
                execute=add,
            )
        ],
        model_provider=provider,
    )

    first = client.agents.run(
        agent_id="gemini-tool-user",
        input="add two numbers",
        session_id="shared-session",
    )
    second = client.agents.run(
        agent_id="gpt-followup",
        input="What did the last agent say?",
        session_id=first.session_id,
    )

    assert second.session_id == "shared-session"
    assert second.output == "GPT answered the follow-up."
    assert [(agent_id, provider_name) for agent_id, provider_name, _ in provider.calls] == [
        ("gemini-tool-user", "google"),
        ("gemini-tool-user", "google"),
        ("gpt-followup", "openai"),
    ]
    openai_messages = provider.calls[2][2]
    assert [(message.role, message.content) for message in openai_messages] == [
        ("user", "add two numbers"),
        ("assistant", "Gemini answered with 5."),
        ("user", "What did the last agent say?"),
    ]
    assert all(not isinstance(message.content, list) for message in openai_messages)
    assert all(message.tool_calls is None for message in openai_messages)
    assert all(message.tool_call_id is None for message in openai_messages)

    stored = client.sessions.get_messages("shared-session")
    assert [(message.role, message.content) for message in stored] == [
        ("user", "add two numbers"),
        ("assistant", "Gemini answered with 5."),
        ("user", "What did the last agent say?"),
        ("assistant", "GPT answered the follow-up."),
    ]


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


def test_local_sdk_accepts_and_validates_runtime_context(tmp_path: Path) -> None:
    client = agntz(agents=str(_copy_agents(tmp_path)), model_provider=FakeProvider())

    result = client.agents.run(
        agent_id="support",
        input={"userQuery": "Refund request"},
        context=["app/user/u_123"],
    )

    assert result.output == {"answer": "Use the refund workflow.", "confidence": 0.82}
    with pytest.raises(NamespaceGrantError):
        client.agents.run(
            agent_id="support",
            input={"userQuery": "Refund request"},
            context=[" app/user/u_123"],
        )


def test_local_sdk_rejects_context_against_namespace_policy(tmp_path: Path) -> None:
    client = agntz(
        agents=str(_copy_agents(tmp_path)),
        model_provider=FakeProvider(),
        namespace_policy={
            "protectedNamespaces": [{"namespace": "gymtext/private/users"}],
        },
    )

    with pytest.raises(NamespaceGrantError):
        client.agents.run(
            agent_id="support",
            input={"userQuery": "Refund request"},
            context=["gymtext"],
        )

    result = client.agents.run(
        agent_id="support",
        input={"userQuery": "Refund request"},
        context=["gymtext/private/users/u_123"],
    )
    assert result.output == {"answer": "Use the refund workflow.", "confidence": 0.82}


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


def test_local_sdk_invokes_mcp_tool(tmp_path: Path) -> None:
    agents_dir = _copy_agents(tmp_path)
    (agents_dir / "mcp-search.yaml").write_text(
        """
id: search
kind: tool
tool:
  kind: mcp
  name: search
  server: https://mcp.example.test
  params:
    query: "{{userQuery}}"
inputSchema:
  userQuery: string
""",
        encoding="utf-8",
    )

    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.read())
        assert request.method == "POST"
        assert request.url.path == "/"
        assert body["method"] == "tools/call"
        assert body["params"] == {
            "name": "search",
            "arguments": {"query": "refund policy"},
        }
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": body["id"], "result": {"ok": True}},
        )

    client = agntz(
        agents=str(agents_dir),
        model_provider=FakeProvider(),
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    )

    result = client.agents.run(agent_id="search", input={"userQuery": "refund policy"})

    assert result.output == {"ok": True}


def test_litellm_provider_model_slug_mapping() -> None:
    assert isinstance(LiteLLMModelProvider(), LiteLLMModelProvider)
    assert format_litellm_model("openai", "gpt-5.4") == "gpt-5.4"
    assert format_litellm_model("google", "gemini-3.5-flash") == "gemini/gemini-3.5-flash"
    assert format_litellm_model("openrouter", "openai/gpt-5.4") == "openrouter/openai/gpt-5.4"
    assert format_litellm_model("anthropic", "claude-sonnet-4.5") == ("anthropic/claude-sonnet-4.5")


def test_litellm_provider_preserves_reasoning_usage_details() -> None:
    usage = {
        "prompt_tokens": 10,
        "completion_tokens": 8,
        "total_tokens": 18,
        "prompt_tokens_details": {"cached_tokens": 3},
        "completion_tokens_details": {"reasoning_tokens": 5, "text_tokens": 3},
    }

    assert _usage_from_litellm(usage) == {
        "promptTokens": 10,
        "completionTokens": 8,
        "totalTokens": 18,
        "outputTokenDetails": {"reasoningTokens": 5, "textTokens": 3},
        "inputTokenDetails": {"cacheReadTokens": 3},
        "cachedInputTokens": 3,
        "reasoningTokens": 5,
    }


def test_local_sdk_can_persist_runs_to_sqlite(tmp_path: Path) -> None:
    agents_dir = _copy_agents(tmp_path)
    db_path = tmp_path / "agntz.sqlite"
    store = SQLiteStore(db_path)
    client = agntz(agents=str(agents_dir), model_provider=FakeProvider(), store=store)

    result = client.agents.run(agent_id="support", input={"userQuery": "Refund request"})
    persisted = client.runs.list(agent_id="support", status="completed")
    store.close()

    reopened = SQLiteStore(db_path)
    try:
        rows = reopened.list_runs(agent_id="support", status="completed")
        traces = reopened.list_traces(agent_id="support", status="ok")
        trace_spans = reopened.list_trace_spans(traces[0].trace_id)
        sessions = reopened.list_sessions(agent_id="support")
        messages = reopened.get_messages(result.session_id)
        fetched = reopened.get_run(persisted[0].id)
    finally:
        reopened.close()

    assert len(rows) == 1
    assert len(traces) == 1
    assert len(trace_spans) == 1
    assert trace_spans[0].kind == "model"
    assert traces[0].output == result.output
    assert fetched is not None
    assert fetched.output == result.output
    assert fetched.input == {"userQuery": "Refund request"}
    assert len(sessions) == 1
    assert sessions[0].message_count == 2
    assert [message.role for message in messages] == ["user", "assistant"]
    assert messages[0].content == '{"userQuery":"Refund request"}'


def test_local_sdk_resolves_versioned_agent_refs_and_dedupes_sqlite_imports(
    tmp_path: Path,
) -> None:
    agents_dir = _copy_agents(tmp_path)
    db_path = tmp_path / "agntz.sqlite"
    store = SQLiteStore(db_path)
    client = agntz(agents=str(agents_dir), model_provider=FakeProvider(), store=store)

    versions = client.agents.list_versions("support")
    assert len(versions) == 1
    created_at = versions[0].created_at
    client.agents.set_alias("support", "stable", created_at)

    assert client.agents.run(agent_id="support@latest", input={"userQuery": "x"}).output == {
        "answer": "Use the refund workflow.",
        "confidence": 0.82,
    }
    assert client.agents.run(agent_id=f"support@{created_at}", input={"userQuery": "x"}).output
    assert client.agents.run(agent_id="support@stable", input={"userQuery": "x"}).output
    store.close()

    reopened = SQLiteStore(db_path)
    try:
        agntz(agents=str(agents_dir), model_provider=FakeProvider(), store=reopened)
        assert len(reopened.list_agent_versions("support")) == 1
    finally:
        reopened.close()


def test_local_sdk_runs_eval_and_updates_latest_score(tmp_path: Path) -> None:
    client = agntz(agents=str(_copy_agents(tmp_path)), model_provider=FakeProvider())
    dataset = client.datasets.create(
        agent_id="support",
        name="Support cases",
        items=[{"input": {"userQuery": "Refund request"}, "expected": {"answer": "refund"}}],
    )
    definition = client.evals.create(
        agent_id="support",
        name="Support rubric",
        default_dataset_id=dataset.id,
        criteria=[{"id": "helpful", "name": "Helpful"}],
    )

    run = client.evals.run(eval_id=definition.id)
    latest = client.evals.get_latest_score(
        eval_id=definition.id,
        dataset_id=dataset.id,
        resolved_agent_version=run.agent_version,
    )

    assert run.status == "completed"
    assert run.summary is not None
    assert run.summary.total_cases == 1
    assert run.summary.passed is True
    assert latest is not None
    assert latest.run_id == run.id
    assert latest.overall_score == 1
