"""YAML parsing and normalization for Agntz manifests."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from .types import (
    AgentManifest,
    LLMAgentManifest,
    ModelConfig,
    ParallelAgentManifest,
    SequentialAgentManifest,
    StepRef,
    ToolAgentManifest,
    ToolCallConfig,
)

_TOOL_KINDS = {"mcp", "local", "http"}


class ManifestParseError(ValueError):
    """Raised when a manifest cannot be parsed or normalized."""


def parse_manifest(source: str) -> AgentManifest:
    raw = yaml.safe_load(source)
    if not isinstance(raw, dict):
        raise ManifestParseError("Agent manifest must be a YAML object")
    return normalize_manifest(raw)


def load_manifest_file(path: str | Path) -> AgentManifest:
    return parse_manifest(Path(path).read_text(encoding="utf-8"))


def normalize_manifest(raw: dict[str, Any]) -> AgentManifest:
    kind = raw.get("kind")
    if kind == "llm":
        return _normalize_llm(raw)
    if kind == "tool":
        return _normalize_tool(raw)
    if kind == "sequential":
        return _normalize_sequential(raw)
    if kind == "parallel":
        return _normalize_parallel(raw)
    raise ManifestParseError(f"Unknown agent kind: {kind}")


def _normalize_llm(raw: dict[str, Any]) -> LLMAgentManifest:
    model = raw.get("model")
    if not isinstance(model, dict):
        raise ManifestParseError("LLM agent must have a 'model' object")
    return LLMAgentManifest(
        **_base(raw),
        kind="llm",
        model=ModelConfig(
            provider=_required_string(model, "provider"),
            name=_required_string(model, "name"),
            **{key: model[key] for key in ("temperature", "maxTokens", "topP") if key in model},
        ),
        instruction=_required_string(raw, "instruction"),
        prompt=raw.get("prompt") if isinstance(raw.get("prompt"), str) else None,
        examples=raw.get("examples"),
        tools=raw.get("tools"),
        outputSchema=raw.get("outputSchema"),
        spawnable=raw.get("spawnable"),
        skills=raw.get("skills"),
        reply=_normalize_reply(raw.get("reply")) if "reply" in raw else None,
    )


def _normalize_tool(raw: dict[str, Any]) -> ToolAgentManifest:
    tool = raw.get("tool")
    if not isinstance(tool, dict):
        raise ManifestParseError("Tool agent must have a 'tool' object")
    kind = tool.get("kind")
    if kind not in _TOOL_KINDS:
        raise ManifestParseError("Tool config 'kind' must be one of mcp, local, or http")
    return ToolAgentManifest(
        **_base(raw),
        kind="tool",
        tool=ToolCallConfig(
            kind=kind,
            name=_required_string(tool, "name"),
            params=tool.get("params"),
            server=tool.get("server"),
            url=tool.get("url"),
            method=tool.get("method"),
            description=tool.get("description"),
            headers=tool.get("headers"),
        ),
    )


def _normalize_sequential(raw: dict[str, Any]) -> SequentialAgentManifest:
    steps = raw.get("steps")
    if not isinstance(steps, list):
        raise ManifestParseError("Sequential agent must have a 'steps' array")
    return SequentialAgentManifest(
        **_base(raw),
        kind="sequential",
        steps=[_normalize_step(step) for step in steps],
        until=raw.get("until"),
        maxIterations=raw.get("maxIterations"),
        output=raw.get("output"),
    )


def _normalize_parallel(raw: dict[str, Any]) -> ParallelAgentManifest:
    branches = raw.get("branches")
    if not isinstance(branches, list):
        raise ManifestParseError("Parallel agent must have a 'branches' array")
    return ParallelAgentManifest(
        **_base(raw),
        kind="parallel",
        branches=[_normalize_step(step) for step in branches],
        output=raw.get("output"),
    )


def _normalize_step(raw: Any) -> StepRef:
    if not isinstance(raw, dict):
        raise ManifestParseError("Pipeline step must be an object")
    agent = raw.get("agent")
    if isinstance(agent, dict):
        agent = normalize_manifest(agent)
    elif agent is not None:
        raise ManifestParseError("Step 'agent' must be an inline manifest object")
    if not isinstance(raw.get("ref"), str) and agent is None:
        raise ManifestParseError("Step must have either 'ref' or inline 'agent'")
    return StepRef(
        ref=raw.get("ref"),
        agent=agent,
        input=raw.get("input"),
        stateKey=raw.get("stateKey"),
        when=raw.get("when"),
    )


def _base(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _required_string(raw, "id"),
        "name": raw.get("name"),
        "description": raw.get("description"),
        "inputSchema": raw.get("inputSchema"),
        "stateKey": raw.get("stateKey"),
    }


def _required_string(raw: dict[str, Any], key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise ManifestParseError(f"Agent manifest field '{key}' must be a non-empty string")
    return value


def _normalize_reply(value: Any) -> bool | dict[str, Any] | None:
    if value is True:
        return True
    if value is False:
        return None
    if isinstance(value, dict):
        max_per_run = value.get("maxPerRun")
        if max_per_run is not None and (
            not isinstance(max_per_run, int | float) or max_per_run < 1
        ):
            raise ManifestParseError("'reply.maxPerRun' must be a positive number")
        return value
    raise ManifestParseError("'reply' must be a boolean or object")
