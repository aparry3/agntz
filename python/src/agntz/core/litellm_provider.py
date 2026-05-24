"""LiteLLM-backed model provider for embedded local execution."""

from __future__ import annotations

import importlib
from typing import Any

from agntz.manifest import LLMAgentManifest
from agntz.manifest.types import AgentState

from .model_provider import GenerateTextResult, ModelTool, ToolCall, ToolResult


class LiteLLMModelProvider:
    """Model provider that lazy-loads LiteLLM when first used."""

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
        try:
            litellm: Any = importlib.import_module("litellm")
        except ImportError as exc:
            raise RuntimeError("Install agntz[litellm] to use LiteLLMModelProvider") from exc

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": instruction},
            {"role": "user", "content": prompt or state.get("userQuery", "")},
        ]
        if tool_results:
            messages.append(
                {
                    "role": "user",
                    "content": "Tool results:\n"
                    + "\n".join(f"{result.name}: {result.output}" for result in tool_results),
                }
            )
        request: dict[str, Any] = {
            "model": format_litellm_model(manifest.model.provider, manifest.model.name),
            "messages": messages,
            "temperature": manifest.model.temperature,
            "max_tokens": manifest.model.max_tokens,
            "top_p": manifest.model.top_p,
        }
        if tools:
            request["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema or {"type": "object", "properties": {}},
                    },
                }
                for tool in tools
            ]

        response = await litellm.acompletion(
            **request,
        )
        choice = response.choices[0]
        text = choice.message.content or ""
        tool_calls = [
            ToolCall(
                id=str(call.id),
                name=str(call.function.name),
                input=_parse_tool_arguments(call.function.arguments),
            )
            for call in getattr(choice.message, "tool_calls", []) or []
        ]
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
            tool_calls=tool_calls,
        )


def format_litellm_model(provider: str, name: str) -> str:
    if provider == "openai":
        return name
    if provider == "google":
        return f"gemini/{name}"
    if provider == "openrouter":
        return f"openrouter/{name}"
    return f"{provider}/{name}"


def _parse_tool_arguments(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        import json

        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}
