"""Model provider protocol for embedded local execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from agntz.manifest import LLMAgentManifest
from agntz.manifest.types import AgentState


@dataclass(frozen=True)
class GenerateTextResult:
    output: Any
    text: str | None = None
    usage: dict[str, int] = field(default_factory=dict)
    model: str | None = None


class ModelProvider(Protocol):
    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> GenerateTextResult: ...


class MissingModelProvider:
    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> GenerateTextResult:
        raise RuntimeError(
            "No model_provider was configured. Pass a Python ModelProvider to agntz(...)."
        )
