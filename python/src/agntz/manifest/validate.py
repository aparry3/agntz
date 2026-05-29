"""Lightweight manifest validation for the Python port."""

from __future__ import annotations

import re
from typing import Any

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
        if step.ref and available_agents is not None and step.ref not in available_agents:
            errors.append(f"{manifest.id}[{index}] references unknown agent '{step.ref}'")
        if step.agent is not None:
            errors.extend(validate_manifest(step.agent, available_agents=available_agents))


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
