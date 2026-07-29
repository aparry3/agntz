"""Lightweight manifest validation for the Python port."""

from __future__ import annotations

import re
from typing import Any

from agntz.agent_ref import InvalidAgentRefError, parse_agent_ref

from .types import (
    AgentManifest,
    ParallelAgentManifest,
    ResourceManifestEntry,
    SequentialAgentManifest,
    StepRef,
)

_RESOURCE_NAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_-]*$")


def validate_manifest(
    manifest: AgentManifest,
    *,
    available_agents: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
    if manifest.kind == "llm" and manifest.resources:
        _validate_resources(manifest.resources, "resources", errors)
        _validate_resource_tool_collisions(manifest.resources, manifest.tools or [], errors)
    if manifest.kind == "llm":
        _validate_llm_agent_refs(manifest, available_agents, errors)
    if manifest.kind == "sequential":
        _validate_steps(manifest, manifest.steps, available_agents, errors)
    elif manifest.kind == "parallel":
        _validate_steps(manifest, manifest.branches, available_agents, errors)
    return errors


def assert_valid_manifest(
    manifest: AgentManifest,
    *,
    available_agents: set[str] | None = None,
) -> None:
    errors = validate_manifest(manifest, available_agents=available_agents)
    if errors:
        raise ValueError("; ".join(errors))


def _validate_steps(
    manifest: SequentialAgentManifest | ParallelAgentManifest,
    steps: list[StepRef],
    available_agents: set[str] | None,
    errors: list[str],
) -> None:
    for index, step in enumerate(steps):
        if step.ref:
            _validate_agent_ref(
                step.ref,
                f"{manifest.id}[{index}]",
                available_agents,
                errors,
            )
        if step.agent is not None:
            errors.extend(validate_manifest(step.agent, available_agents=available_agents))


def _validate_llm_agent_refs(
    manifest: AgentManifest,
    available_agents: set[str] | None,
    errors: list[str],
) -> None:
    for index, entry in enumerate(getattr(manifest, "spawnable", None) or []):
        if not isinstance(entry, dict) or entry.get("kind") != "ref":
            continue
        agent_id = entry.get("agentId")
        if isinstance(agent_id, str):
            version = entry.get("version")
            value = f"{agent_id}@{version}" if isinstance(version, str) else agent_id
            _validate_agent_ref(value, f"spawnable[{index}]", available_agents, errors)
    for index, entry in enumerate(getattr(manifest, "tools", None) or []):
        if not isinstance(entry, dict) or entry.get("kind") != "agent":
            continue
        agent_id = entry.get("agent")
        if isinstance(agent_id, str):
            version = entry.get("version")
            value = f"{agent_id}@{version}" if isinstance(version, str) else agent_id
            _validate_agent_ref(value, f"tools[{index}].agent", available_agents, errors)


def _validate_agent_ref(
    value: str,
    path: str,
    available_agents: set[str] | None,
    errors: list[str],
) -> None:
    try:
        agent_id = parse_agent_ref(value).agent_id
    except InvalidAgentRefError as exc:
        errors.append(f"{path} has invalid agent reference: {exc}")
        return
    if available_agents is not None and agent_id not in available_agents:
        errors.append(f"{path} references unknown agent '{value}'")


def _validate_resources(
    resources: dict[str, ResourceManifestEntry],
    path: str,
    errors: list[str],
) -> None:
    for name, entry in resources.items():
        entry_path = f"{path}.{name}"
        if not _RESOURCE_NAME_RE.fullmatch(name):
            errors.append(
                f"{entry_path}: Resource name '{name}' must match {_RESOURCE_NAME_RE.pattern}"
            )
        if not entry.kind or not isinstance(entry.kind, str):
            errors.append(f"{entry_path}.kind: Resource kind must be a string")
        elif not _RESOURCE_NAME_RE.fullmatch(entry.kind):
            errors.append(
                f"{entry_path}.kind: Resource kind '{entry.kind}' must match "
                f"{_RESOURCE_NAME_RE.pattern}"
            )
        if entry.mode is not None and entry.mode not in {"read", "read-write"}:
            errors.append(f"{entry_path}.mode: Resource mode must be 'read' or 'read-write'")
        if entry.namespace is not None:
            namespace = entry.namespace
            valid_namespace = isinstance(namespace, str) or (
                isinstance(namespace, list) and all(isinstance(item, str) for item in namespace)
            )
            if not valid_namespace:
                errors.append(
                    f"{entry_path}.namespace: Resource namespace must be a string "
                    "or array of strings"
                )


def _validate_resource_tool_collisions(
    resources: dict[str, ResourceManifestEntry],
    tool_entries: list[dict[str, Any]],
    errors: list[str],
) -> None:
    prefixes = [f"{_resource_tool_prefix(name)}_" for name in resources]
    for index, entry in enumerate(tool_entries):
        if entry.get("kind") != "local":
            continue
        tools = entry.get("tools")
        if not isinstance(tools, list):
            continue
        for tool_index, tool_name in enumerate(tools):
            if not isinstance(tool_name, str):
                continue
            for prefix in prefixes:
                if tool_name.startswith(prefix):
                    errors.append(
                        f"tools[{index}].tools[{tool_index}]: Local tool '{tool_name}' "
                        f"conflicts with reserved resource tool prefix '{prefix}'"
                    )


def _resource_tool_prefix(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", name)
