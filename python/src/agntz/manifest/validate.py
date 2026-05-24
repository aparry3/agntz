"""Lightweight manifest validation for the Python port."""

from __future__ import annotations

from .types import AgentManifest, ParallelAgentManifest, SequentialAgentManifest, StepRef


def validate_manifest(
    manifest: AgentManifest,
    *,
    available_agents: set[str] | None = None,
) -> list[str]:
    errors: list[str] = []
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
