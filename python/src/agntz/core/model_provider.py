"""Model provider protocol for embedded local execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from agntz.manifest import LLMAgentManifest
from agntz.manifest.types import AgentState


@dataclass(frozen=True)
class ModelTool:
    name: str
    description: str
    input_schema: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    input: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolResult:
    tool_call_id: str
    name: str
    output: Any


@dataclass(frozen=True)
class GenerateTextResult:
    output: Any
    text: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    model: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


class ModelProvider(Protocol):
    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
        tools: list[ModelTool] | None = None,
        tool_results: list[ToolResult] | None = None,
    ) -> GenerateTextResult: ...


class MissingModelProvider:
    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
        tools: list[ModelTool] | None = None,
        tool_results: list[ToolResult] | None = None,
    ) -> GenerateTextResult:
        raise RuntimeError(
            "No model_provider was configured. Pass a Python ModelProvider to agntz(...)."
        )
