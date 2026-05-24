"""LiteLLM-backed model provider for embedded local execution."""

from __future__ import annotations

import importlib
from typing import Any

from agntz.manifest import LLMAgentManifest
from agntz.manifest.types import AgentState

from .model_provider import GenerateTextResult


class LiteLLMModelProvider:
    """Model provider that lazy-loads LiteLLM when first used."""

    async def generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> GenerateTextResult:
        try:
            litellm: Any = importlib.import_module("litellm")
        except ImportError as exc:
            raise RuntimeError("Install agntz[litellm] to use LiteLLMModelProvider") from exc

        response = await litellm.acompletion(
            model=format_litellm_model(manifest.model.provider, manifest.model.name),
            messages=[
                {"role": "system", "content": instruction},
                {"role": "user", "content": prompt or state.get("userQuery", "")},
            ],
            temperature=manifest.model.temperature,
            max_tokens=manifest.model.max_tokens,
            top_p=manifest.model.top_p,
        )
        choice = response.choices[0]
        text = choice.message.content or ""
        usage = getattr(response, "usage", None)
        return GenerateTextResult(
            output=text,
            text=text,
            usage={
                "promptTokens": int(getattr(usage, "prompt_tokens", 0) or 0),
                "completionTokens": int(getattr(usage, "completion_tokens", 0) or 0),
                "totalTokens": int(getattr(usage, "total_tokens", 0) or 0),
            },
            model=manifest.model.name,
        )


def format_litellm_model(provider: str, name: str) -> str:
    if provider == "openai":
        return name
    if provider == "google":
        return f"gemini/{name}"
    if provider == "openrouter":
        return f"openrouter/{name}"
    return f"{provider}/{name}"
