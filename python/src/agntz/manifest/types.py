"""Manifest models shared by the Python parser and executor."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol, TypeAlias

from pydantic import BaseModel, ConfigDict, Field

AgentState: TypeAlias = dict[str, Any]
InputSchema: TypeAlias = dict[str, Any]
OutputMapping: TypeAlias = dict[str, Any]


class ManifestModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="allow")


class ModelConfig(ManifestModel):
    provider: str
    name: str
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, alias="maxTokens")
    top_p: float | None = Field(default=None, alias="topP")


class AgentManifestBase(ManifestModel):
    id: str
    name: str | None = None
    description: str | None = None
    input_schema: InputSchema | None = Field(default=None, alias="inputSchema")
    state_key: str | None = Field(default=None, alias="stateKey")


class StepRef(ManifestModel):
    ref: str | None = None
    agent: Any | None = None
    input: dict[str, str] | None = None
    state_key: str | None = Field(default=None, alias="stateKey")
    when: str | None = None


class ToolCallConfig(ManifestModel):
    kind: Literal["mcp", "local", "http"]
    name: str
    params: dict[str, Any] | None = None
    server: str | None = None
    url: str | None = None
    method: str | None = None
    description: str | None = None
    headers: dict[str, str] | None = None


class LLMAgentManifest(AgentManifestBase):
    kind: Literal["llm"] = "llm"
    model: ModelConfig
    instruction: str
    prompt: str | None = None
    examples: list[dict[str, Any]] | None = None
    tools: list[dict[str, Any]] | None = None
    output_schema: dict[str, Any] | None = Field(default=None, alias="outputSchema")
    spawnable: list[Any] | None = None
    skills: list[str] | None = None
    reply: bool | dict[str, Any] | None = None


class ToolAgentManifest(AgentManifestBase):
    kind: Literal["tool"] = "tool"
    tool: ToolCallConfig


class SequentialAgentManifest(AgentManifestBase):
    kind: Literal["sequential"] = "sequential"
    steps: list[StepRef]
    until: str | None = None
    max_iterations: int | None = Field(default=None, alias="maxIterations")
    output: OutputMapping | None = None


class ParallelAgentManifest(AgentManifestBase):
    kind: Literal["parallel"] = "parallel"
    branches: list[StepRef]
    output: OutputMapping | None = None


AgentManifest: TypeAlias = (
    LLMAgentManifest | ToolAgentManifest | SequentialAgentManifest | ParallelAgentManifest
)


@dataclass(frozen=True)
class ExecutionResult:
    output: Any
    state: AgentState


class ExecutionContext(Protocol):
    async def invoke_llm(
        self,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> Any: ...

    async def invoke_tool(self, config: ToolCallConfig, state: AgentState) -> Any: ...

    async def resolve_agent(self, agent_id: str) -> AgentManifest: ...
