from __future__ import annotations

import asyncio
import contextlib
import json
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import yaml

from agntz import LiteLLMModelProvider, MemoryStore, agntz, tool
from agntz.stores import LocalMessageRecord

AGENT_ID = "provider-harness"


def main() -> None:
    payload = json.loads(sys.stdin.read())
    with contextlib.redirect_stdout(sys.stderr):
        result = asyncio.run(run(payload))
    sys.stdout.write(json.dumps(result, separators=(",", ":")))


async def run(payload: dict[str, Any]) -> dict[str, Any]:
    model = payload["model"]
    messages = payload.get("messages") or []
    system_prompt, prior_messages, input_value = split_runtime_messages(messages)
    session_id = f"provider-harness-{uuid4()}"
    executed_tools: list[dict[str, Any]] = []
    store = MemoryStore()

    with tempfile.TemporaryDirectory(prefix="agntz-provider-harness-") as tmp:
        agents_dir = Path(tmp)
        (agents_dir / "provider-harness.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": AGENT_ID,
                    "kind": "llm",
                    "name": "Provider Harness",
                    "instruction": system_prompt,
                    "model": {
                        "provider": str(model["provider"]),
                        "name": str(model["name"]),
                        **(
                            {"maxTokens": int(payload["maxTokens"])}
                            if payload.get("maxTokens") is not None
                            else {}
                        ),
                    },
                    **(
                        {
                            "tools": [
                                {"kind": "local", "name": "__harness_tools__", "tools": [t["name"]]}
                                for t in payload.get("tools") or []
                            ]
                        }
                        if payload.get("tools")
                        else {}
                    ),
                    **(
                        {"outputSchema": payload["outputSchema"]["schema"]}
                        if payload.get("outputSchema")
                        else {}
                    ),
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )

        client = agntz(
            agents=str(agents_dir),
            tools=[runtime_tool(spec, executed_tools) for spec in payload.get("tools") or []],
            model_provider=LiteLLMModelProvider(),
            store=store,
        )

        if prior_messages:
            store.append_messages(
                session_id,
                [
                    LocalMessageRecord(
                        session_id=session_id,
                        agent_id=AGENT_ID,
                        role=str(message["role"]),
                        content=to_runtime_content(message.get("content", "")),
                        tool_calls=message.get("tool_calls"),
                        tool_call_id=message.get("tool_call_id"),
                        timestamp=datetime.now(tz=UTC).isoformat(),
                    )
                    for message in prior_messages
                ],
                agent_id=AGENT_ID,
            )

        result = await client.agents.arun(
            agent_id=AGENT_ID,
            input=input_value,
            session_id=session_id,
        )

    trace_summaries = client.traces.list(agent_id=AGENT_ID).get("rows", [])
    model_usage = usage_from_traces(client, trace_summaries)
    session_messages = [
        {
            "role": message.role,
            "content": message.content,
            **({"tool_calls": message.tool_calls} if message.tool_calls else {}),
            **({"tool_call_id": message.tool_call_id} if message.tool_call_id else {}),
        }
        for message in store.get_messages(session_id)
    ]

    output = result.output
    return {
        "text": output if isinstance(output, str) else json.dumps(output, separators=(",", ":")),
        "toolCalls": executed_tools,
        "usage": model_usage,
        "finishReason": "completed",
        "sessionMessages": session_messages,
    }


def runtime_tool(spec: dict[str, Any], executed_tools: list[dict[str, Any]]) -> Any:
    name = str(spec["name"])

    async def execute(params: Any) -> Any:
        payload = params if isinstance(params, dict) else {}
        city = str(payload.get("city") or "unknown")
        output = {"forecast": "18°C and sunny", "city": city}
        executed_tools.append(
            {"id": f"local-{len(executed_tools) + 1}", "name": name, "args": payload}
        )
        return output

    return tool(
        name=name,
        description=str(spec.get("description") or name),
        input_schema=dict(spec.get("parameters") or {"type": "object", "properties": {}}),
        execute=execute,
    )


def split_runtime_messages(
    messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]], str | list[dict[str, Any]]]:
    system_prompt = "\n\n".join(
        str(message.get("content", ""))
        for message in messages
        if message.get("role") == "system"
    )
    non_system = [message for message in messages if message.get("role") != "system"]
    final_user_index = -1
    for index, message in enumerate(non_system):
        if message.get("role") == "user":
            final_user_index = index
    if final_user_index == -1:
        raise RuntimeError("runtime harness requires a final user message")
    final_user = non_system[final_user_index]
    return (
        system_prompt or "You are a concise test assistant.",
        non_system[:final_user_index],
        to_runtime_content(final_user.get("content", "")),
    )


def to_runtime_content(value: Any) -> str | list[dict[str, Any]]:
    if not isinstance(value, list):
        return str(value or "")
    parts: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            parts.append({"type": "text", "text": str(item)})
            continue
        if item.get("type") == "image" and isinstance(item.get("image"), str):
            image = item["image"]
            if image.startswith("data:") and ";base64," in image:
                media_type, base64_body = image.removeprefix("data:").split(";base64,", 1)
                parts.append({"type": "image", "mediaType": media_type, "base64": base64_body})
            else:
                parts.append({"type": "image", "url": image})
            continue
        parts.append(dict(item))
    return parts


def usage_from_traces(client: Any, summaries: list[dict[str, Any]]) -> dict[str, Any]:
    usage: dict[str, Any] = {"promptTokens": 0, "completionTokens": 0, "totalTokens": 0}
    for summary in summaries:
        detail = client.traces.get(summary["traceId"])
        if not detail:
            continue
        for span in detail.get("spans", []):
            attributes = span.get("attributes") or {}
            span_usage = attributes.get("usage")
            if not isinstance(span_usage, dict):
                continue
            usage["promptTokens"] += int(span_usage.get("promptTokens") or 0)
            usage["completionTokens"] += int(span_usage.get("completionTokens") or 0)
            usage["totalTokens"] += int(span_usage.get("totalTokens") or 0)
            _accumulate_optional_usage(usage, span_usage)
    return usage


def _accumulate_optional_usage(usage: dict[str, Any], span_usage: dict[str, Any]) -> None:
    reasoning_tokens = _int_value(span_usage.get("reasoningTokens"))
    if reasoning_tokens is not None:
        usage["reasoningTokens"] = int(usage.get("reasoningTokens") or 0) + reasoning_tokens

    cached_input_tokens = _int_value(span_usage.get("cachedInputTokens"))
    if cached_input_tokens is not None:
        usage["cachedInputTokens"] = (
            int(usage.get("cachedInputTokens") or 0) + cached_input_tokens
        )

    input_details = span_usage.get("inputTokenDetails")
    if isinstance(input_details, dict):
        target = usage.setdefault("inputTokenDetails", {})
        if isinstance(target, dict):
            for key in ("noCacheTokens", "cacheReadTokens", "cacheWriteTokens"):
                value = _int_value(input_details.get(key))
                if value is not None:
                    target[key] = int(target.get(key) or 0) + value

    output_details = span_usage.get("outputTokenDetails")
    if isinstance(output_details, dict):
        target = usage.setdefault("outputTokenDetails", {})
        if isinstance(target, dict):
            for key in ("textTokens", "reasoningTokens"):
                value = _int_value(output_details.get(key))
                if value is not None:
                    target[key] = int(target.get(key) or 0) + value


def _int_value(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


if __name__ == "__main__":
    main()
