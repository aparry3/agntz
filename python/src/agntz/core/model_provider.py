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
class ModelMessage:
    role: str
    content: str | list[dict[str, Any]]
    tool_calls: list[dict[str, Any]] | None = None
    tool_call_id: str | None = None


@dataclass(frozen=True)
class GenerateTextResult:
    output: Any
    text: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    model: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    response_messages: list[ModelMessage] = field(default_factory=list)
    finish_reason: str | None = None


class ModelProvider(Protocol):
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
    ) -> GenerateTextResult: ...


class MissingModelProvider:
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
        raise RuntimeError(
            "No model_provider was configured. Pass a Python ModelProvider to agntz(...)."
        )
