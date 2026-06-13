from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from agntz import (
    GenerateTextResult,
    ModelMessage,
    ModelTool,
    ResourceToolContext,
    ToolCall,
    ToolResult,
    agntz,
)
from agntz.manifest.types import AgentState, LLMAgentManifest, ResourceManifestEntry
from agntz.memrez import DeterministicReasoner, TaggerInput, TaggerResult, create_memrez


class MemoryToolProvider:
    def __init__(self, tool_call: ToolCall | None = None) -> None:
        self.tool_call = tool_call
        self.calls: list[dict[str, Any]] = []

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
        self.calls.append(
            {
                "instruction": instruction,
                "tools": list(tools or []),
                "tool_results": list(tool_results or []),
            }
        )
        if self.tool_call and not tool_results:
            return GenerateTextResult(output="", tool_calls=[self.tool_call])
        return GenerateTextResult(output="done")


class PreferredTopicReasoner:
    def __init__(self) -> None:
        self.inputs: list[TaggerInput] = []

    def tag(self, input_value: TaggerInput) -> TaggerResult:
        self.inputs.append(input_value)
        topic = (
            input_value.topic_config.preferred[0]
            if input_value.topic_config and input_value.topic_config.preferred
            else "general"
        )
        return TaggerResult(
            namespace=input_value.grants[0],
            topics=[topic],
            type="preference",
            normalized_content=input_value.content.strip(),
        )


def test_memory_resource_registers_tools_and_injects_scan_context(tmp_path: Path) -> None:
    agents_dir = _agents_dir(
        tmp_path,
        """
id: support
kind: llm
model:
  provider: openai
  name: test
instruction: Use memory when useful.
resources:
  memory:
    kind: memory
    mode: read-write
    autoScan: true
""",
    )
    memrez = create_memrez(reasoner=DeterministicReasoner())
    memrez.write(["app/user/u_123"], "Prefers metric units.", topics_hint=["prefs"])
    provider = MemoryToolProvider(
        ToolCall(id="call_1", name="memory_read", input={"topic": "prefs"})
    )
    client = agntz(
        agents=str(agents_dir),
        resources={"memory": memrez.provider()},
        model_provider=provider,
    )

    result = client.agents.run(
        agent_id="support",
        input="what do you know?",
        context=["app/user/u_123"],
    )

    assert result.output == "done"
    assert [tool.name for tool in provider.calls[0]["tools"]] == [
        "memory_read",
        "memory_write",
    ]
    assert "Memory topics visible to this run" in provider.calls[0]["instruction"]
    assert "prefs (1)" in provider.calls[0]["instruction"]
    tool_output = provider.calls[1]["tool_results"][0].output
    assert [entry.content for entry in tool_output] == ["Prefers metric units."]


def test_memory_resource_omits_write_tool_in_read_mode(tmp_path: Path) -> None:
    agents_dir = _agents_dir(
        tmp_path,
        """
id: reader
kind: llm
model:
  provider: openai
  name: test
instruction: Read memory.
resources:
  memory:
    kind: memory
    mode: read
""",
    )
    memrez = create_memrez(reasoner=DeterministicReasoner())
    provider = MemoryToolProvider()
    client = agntz(
        agents=str(agents_dir),
        resources={"memory": memrez.provider()},
        model_provider=provider,
    )

    client.agents.run(agent_id="reader", input="go", context=["app/user/u_123"])

    assert [tool.name for tool in provider.calls[0]["tools"]] == ["memory_read"]


def test_memory_resource_writes_with_run_source(tmp_path: Path) -> None:
    agents_dir = _agents_dir(
        tmp_path,
        """
id: writer
kind: llm
model:
  provider: openai
  name: test
instruction: Write memory.
resources:
  memory:
    kind: memory
    mode: read-write
    topics:
      preferred: [prefs]
    writePolicy:
      descendants: true
      ancestorPromotion: none
""",
    )
    reasoner = PreferredTopicReasoner()
    memrez = create_memrez(reasoner=reasoner)
    provider = MemoryToolProvider(
        ToolCall(
            id="call_1",
            name="memory_write",
            input={"content": "Prefers email."},
        )
    )
    client = agntz(
        agents=str(agents_dir),
        resources={"memory": memrez.provider()},
        model_provider=provider,
    )

    client.agents.run(
        agent_id="writer",
        input="remember",
        session_id="ses_1",
        context=["app/user/u_123"],
    )
    entries = memrez.read(["app/user/u_123"], "prefs")

    assert [entry.content for entry in entries] == ["Prefers email."]
    assert reasoner.inputs[0].topic_config is not None
    assert reasoner.inputs[0].topic_config.preferred == ("prefs",)
    assert entries[0].source is not None
    assert entries[0].source.get("agentId") == "writer"
    assert entries[0].source.get("sessionId") == "ses_1"
    assert entries[0].source.get("runId", "").startswith("run_")


def test_memory_resource_preloads_configured_topics() -> None:
    memrez = create_memrez(reasoner=DeterministicReasoner())
    memrez.write(["app/user/u_123"], "Always load this.", topics_hint=["profile"])
    memrez.write(["app/user/u_123"], "Include this goal.", topics_hint=["goals"])
    memrez.write(
        ["app/user/u_123"],
        "Do not preload this event.",
        type="event",
        topics_hint=["schedule"],
    )

    context = memrez.provider().get_context(
        _resource_tool_context(
            {
                "autoScan": False,
                "topics": {"core": "profile", "preferred": ["goals", "schedule"]},
                "preload": {
                    "core": True,
                    "topics": ["goals", "schedule"],
                    "types": ["fact", "preference", "summary"],
                    "limit": 30,
                    "maxChars": 10_000,
                },
            }
        )
    )

    assert context is not None
    assert "Preloaded memory entries" in context
    assert "Always load this." in context
    assert "Include this goal." in context
    assert "Do not preload this event." not in context


def test_memory_resource_preload_all_uses_durable_types_and_limit() -> None:
    memrez = create_memrez(reasoner=DeterministicReasoner())
    memrez.write(["app/user/u_123"], "Fact one.", topics_hint=["prefs"])
    memrez.write(["app/user/u_123"], "Fact two.", topics_hint=["goals"])
    memrez.write(["app/user/u_123"], "Transient.", type="event", topics_hint=["events"])

    context = memrez.provider().get_context(
        _resource_tool_context(
            {
                "autoScan": False,
                "preload": "all",
                "preloadLimit": 1,
            }
        )
    )

    assert context is not None
    assert context.count("- [") == 1
    assert "Transient." not in context
    assert "more entries not shown" in context


def test_memory_resource_rejects_invalid_preload_string() -> None:
    memrez = create_memrez(reasoner=DeterministicReasoner())

    with pytest.raises(ValueError, match='memory.preload string value must be "all"'):
        memrez.provider().get_context(_resource_tool_context({"preload": "profile"}))


def test_memory_resource_missing_provider_fails_when_agent_runs(tmp_path: Path) -> None:
    agents_dir = _agents_dir(
        tmp_path,
        """
id: support
kind: llm
model:
  provider: openai
  name: test
instruction: Use memory.
resources:
  memory:
    kind: memory
""",
    )
    client = agntz(agents=str(agents_dir), model_provider=MemoryToolProvider())

    with pytest.raises(RuntimeError, match="no ResourceProvider is wired"):
        client.agents.run(agent_id="support", input="go", context=["app/user/u_123"])


def _agents_dir(tmp_path: Path, manifest: str) -> Path:
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    (agents_dir / "agent.yaml").write_text(manifest, encoding="utf-8")
    return agents_dir


def _resource_tool_context(config: dict[str, Any]) -> ResourceToolContext:
    return ResourceToolContext(
        resource_name="memory",
        kind="memory",
        mode="read-write",
        config=ResourceManifestEntry(kind="memory", mode="read-write", **config),
        grants=["app/user/u_123"],
        run={"agentId": "agent", "sessionId": "session", "runId": "run"},
    )
