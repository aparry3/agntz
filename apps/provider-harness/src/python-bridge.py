from __future__ import annotations

import asyncio
import contextlib
import json
import sys
from typing import Any

from agntz.core import LiteLLMModelProvider, ModelMessage, ModelTool
from agntz.manifest.types import LLMAgentManifest, ModelConfig


def main() -> None:
    payload = json.loads(sys.stdin.read())
    with contextlib.redirect_stdout(sys.stderr):
        result = asyncio.run(run(payload))
    sys.stdout.write(json.dumps(result, separators=(",", ":")))


async def run(payload: dict[str, Any]) -> dict[str, Any]:
    model = payload["model"]
    provider = LiteLLMModelProvider()
    result = await provider.generate_text(
        manifest=LLMAgentManifest(
            id="provider-harness",
            kind="llm",
            instruction="",
            model=ModelConfig(
                provider=str(model["provider"]),
                name=str(model["name"]),
                maxTokens=payload.get("maxTokens"),
            ),
            outputSchema=(payload.get("outputSchema") or {}).get("schema"),
        ),
        instruction="",
        prompt=None,
        state={},
        messages=[to_model_message(message) for message in payload.get("messages") or []],
        tools=[to_model_tool(tool) for tool in payload.get("tools") or []],
        tool_results=[],
    )

    return {
        "text": result.text or "",
        "toolCalls": [
            {
                "id": call.id,
                "name": call.name,
                "args": call.input,
            }
            for call in result.tool_calls
        ],
        "usage": result.usage,
        "finishReason": result.finish_reason,
        "responseMessages": [
            {
                "role": message.role,
                "content": message.content,
                **({"tool_calls": message.tool_calls} if message.tool_calls else {}),
                **({"tool_call_id": message.tool_call_id} if message.tool_call_id else {}),
            }
            for message in result.response_messages
        ],
    }


def to_model_message(value: dict[str, Any]) -> ModelMessage:
    role = str(value["role"])
    content = normalize_content(value.get("content", ""))
    if role == "tool":
        content = tool_content(content)
    return ModelMessage(
        role=role,
        content=content,
        tool_calls=value.get("tool_calls"),
        tool_call_id=value.get("tool_call_id"),
    )


def normalize_content(value: Any) -> str | list[dict[str, Any]]:
    if not isinstance(value, list):
        return value
    parts: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            parts.append({"type": "text", "text": str(item)})
            continue
        if item.get("type") == "image":
            image = item.get("image")
            parts.append({"type": "image_url", "image_url": {"url": image}})
            continue
        parts.append(dict(item))
    return parts


def to_model_tool(value: dict[str, Any]) -> ModelTool:
    return ModelTool(
        name=str(value["name"]),
        description=str(value.get("description") or value["name"]),
        input_schema=dict(value.get("parameters") or {"type": "object", "properties": {}}),
    )


def tool_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        text_values: list[str] = []
        for item in value:
            if isinstance(item, dict) and item.get("type") == "tool-result":
                output = item.get("output")
                if isinstance(output, dict) and output.get("type") == "text":
                    text_values.append(str(output.get("value") or ""))
                else:
                    text_values.append(json.dumps(output, separators=(",", ":")))
        if text_values:
            return "\n".join(text_values)
    return json.dumps(value, separators=(",", ":"))


if __name__ == "__main__":
    main()
