"""State helpers for manifest pipeline execution."""

from __future__ import annotations

import re
from typing import Any

from .template import interpolate, resolve_path
from .types import AgentManifest, AgentManifestBase, AgentState, InputSchema, OutputMapping, StepRef

_SIMPLE_TEMPLATE_RE = re.compile(r"^\{\{(.+?)\}\}$")


def normalize_id(agent_id: str) -> str:
    parts = [part for part in agent_id.split("-") if part]
    if not parts:
        return agent_id
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def get_manifest_state_key(manifest: AgentManifest) -> str:
    return manifest.state_key or normalize_id(manifest.id)


def get_state_key(step: StepRef) -> str:
    if step.state_key:
        return step.state_key
    agent = step.agent
    if isinstance(agent, dict):
        state_key = agent.get("stateKey") or agent.get("state_key")
        if isinstance(state_key, str):
            return state_key
        agent_id = agent.get("id")
        if isinstance(agent_id, str):
            return normalize_id(agent_id)
    if isinstance(agent, AgentManifestBase):
        if agent.state_key:
            return agent.state_key
        return normalize_id(agent.id)
    if step.ref:
        return normalize_id(step.ref)
    return "unknown"


def create_initial_state(input_value: Any, input_schema: InputSchema | None = None) -> AgentState:
    if not input_schema:
        return {"userQuery": input_value if isinstance(input_value, str) else str(input_value)}

    if isinstance(input_value, dict):
        state: AgentState = {}
        for key, definition in input_schema.items():
            if key in input_value:
                state[key] = input_value[key]
            elif isinstance(definition, dict) and "default" in definition:
                state[key] = definition["default"]
            else:
                state[key] = None
        return state

    return {"userQuery": str(input_value)}


def apply_input_transform(
    transform: dict[str, str] | None,
    parent_state: AgentState,
    default_upstream: Any,
) -> Any:
    if not transform:
        return default_upstream

    result: dict[str, Any] = {}
    for key, template in transform.items():
        match = _SIMPLE_TEMPLATE_RE.match(template)
        if match:
            result[key] = resolve_path(parent_state, match.group(1).strip())
        else:
            result[key] = interpolate(template, parent_state)
    return result


def apply_output_mapping(mapping: OutputMapping, state: AgentState) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in mapping.items():
        if isinstance(value, str):
            match = _SIMPLE_TEMPLATE_RE.match(value)
            result[key] = (
                resolve_path(state, match.group(1).strip())
                if match
                else interpolate(value, state)
            )
        elif isinstance(value, dict):
            result[key] = apply_output_mapping(value, state)
        else:
            result[key] = value
    return result
