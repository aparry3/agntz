"""YAML parsing and normalization for Agntz manifests."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from .types import (
    AgentManifest,
    LLMAgentManifest,
    ModelConfig,
    ParallelAgentManifest,
    ResourceManifestEntry,
    SequentialAgentManifest,
    StepRef,
    ToolAgentManifest,
    ToolCallConfig,
)

_TOOL_KINDS = {"mcp", "local", "http"}
_IGNORED_MANIFEST_DIRS = {"node_modules", "dist", "coverage"}
_CLIENT_TOOL_NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]*$")


class ManifestParseError(ValueError):
    """Raised when a manifest cannot be parsed or normalized."""


def parse_manifest(source: str) -> AgentManifest:
    raw = yaml.safe_load(source)
    if not isinstance(raw, dict):
        raise ManifestParseError("Agent manifest must be a YAML object")
    return normalize_manifest(raw)


def load_manifest_file(path: str | Path) -> AgentManifest:
    return parse_manifest(Path(path).read_text(encoding="utf-8"))


def load_manifests_from_dir(path: str | Path) -> dict[str, AgentManifest]:
    manifests: dict[str, AgentManifest] = {}
    for manifest_path in find_manifest_files(path):
        manifest = load_manifest_file(manifest_path)
        if manifest.id in manifests:
            raise ManifestParseError(f"Duplicate agent id '{manifest.id}' in {manifest_path}")
        manifests[manifest.id] = manifest
    return manifests


def find_manifest_files(path: str | Path) -> list[Path]:
    root = Path(path)
    files: list[Path] = []

    def visit(directory: Path) -> None:
        for candidate in sorted(directory.iterdir()):
            if candidate.is_symlink():
                continue
            if candidate.is_dir():
                if candidate.name.startswith(".") or candidate.name in _IGNORED_MANIFEST_DIRS:
                    continue
                visit(candidate)
            elif candidate.is_file() and candidate.suffix.lower() in {".yaml", ".yml"}:
                files.append(candidate)

    visit(root)
    return files


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
        tools=_normalize_llm_tools(raw.get("tools")),
        outputSchema=raw.get("outputSchema"),
        spawnable=raw.get("spawnable"),
        skills=raw.get("skills"),
        reply=_normalize_reply(raw.get("reply")) if "reply" in raw else None,
        resources=_normalize_resources(raw.get("resources")) if "resources" in raw else None,
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
            body_type=tool.get("body_type"),
            body=tool.get("body"),
            auth=tool.get("auth"),
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
    if "ref" in raw and agent is not None:
        raise ManifestParseError("Step cannot have both 'ref' and 'agent'")
    if "ref" in raw and not isinstance(raw["ref"], str):
        raise ManifestParseError("Step 'ref' must be a string")
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
            not isinstance(max_per_run, int)
            or isinstance(max_per_run, bool)
            or max_per_run < 1
        ):
            raise ManifestParseError("'reply.maxPerRun' must be a positive integer")
        return value
    raise ManifestParseError("'reply' must be a boolean or object")


def _normalize_resources(value: Any) -> dict[str, ResourceManifestEntry]:
    if not isinstance(value, dict):
        raise ManifestParseError("'resources' must be an object keyed by resource name")
    resources: dict[str, ResourceManifestEntry] = {}
    for name, raw_entry in value.items():
        if not isinstance(raw_entry, dict):
            raise ManifestParseError(f"resources.{name} must be an object")
        if "kind" in raw_entry and not isinstance(raw_entry["kind"], str):
            raise ManifestParseError(f"resources.{name}.kind must be a string")
        entry = dict(raw_entry)
        entry["kind"] = entry.get("kind") or str(name)
        resources[str(name)] = ResourceManifestEntry(**entry)
    return resources


def _normalize_llm_tools(value: Any) -> list[dict[str, Any]] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ManifestParseError("'tools' must be an array")
    tools: list[dict[str, Any]] = []
    client_names: set[str] = set()
    for index, raw_entry in enumerate(value):
        if not isinstance(raw_entry, dict):
            raise ManifestParseError(f"tools[{index}] must be an object")
        entry = dict(raw_entry)
        if entry.get("kind") == "client":
            name = entry.get("name")
            description = entry.get("description")
            schema = entry.get("inputSchema")
            timeout_ms = entry.get("timeoutMs")
            if not isinstance(name, str) or not _CLIENT_TOOL_NAME_RE.fullmatch(name):
                raise ManifestParseError(
                    f"tools[{index}].name must match {_CLIENT_TOOL_NAME_RE.pattern}"
                )
            if name in client_names:
                raise ManifestParseError(f"Duplicate client tool name '{name}'")
            client_names.add(name)
            if not isinstance(description, str) or not description.strip():
                raise ManifestParseError(
                    f"tools[{index}].description must be a non-empty string"
                )
            if (
                not isinstance(schema, dict)
                or schema.get("type") != "object"
                or not isinstance(schema.get("properties"), dict)
            ):
                raise ManifestParseError(
                    f"tools[{index}].inputSchema must be an object-root JSON Schema"
                )
            if timeout_ms is not None and (
                not isinstance(timeout_ms, int)
                or isinstance(timeout_ms, bool)
                or timeout_ms < 1_000
                or timeout_ms > 120_000
            ):
                raise ManifestParseError(
                    f"tools[{index}].timeoutMs must be an integer from 1000 to 120000"
                )
        tools.append(entry)
    return tools
