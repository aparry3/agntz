"""Command line entrypoints for Agntz."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from typing import Any

from agntz.core import LiteLLMModelProvider
from agntz.manifest import load_manifests_from_dir, validate_manifest
from agntz.sdk import agntz


def main() -> None:
    raise SystemExit(run_cli())


def run_cli(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "validate":
        return _validate(args.agents)
    if args.command == "run":
        return _run(args.agents, args.agent_id, args.input)

    parser.print_help()
    return 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agntz")
    subparsers = parser.add_subparsers(dest="command")

    validate = subparsers.add_parser("validate", help="Validate a directory of agent YAML files")
    validate.add_argument("agents", help="Directory containing .yaml or .yml agent manifests")

    run = subparsers.add_parser("run", help="Run a local agent from YAML")
    run.add_argument("agents", help="Directory containing .yaml or .yml agent manifests")
    run.add_argument("agent_id", help="Agent id to run")
    run.add_argument(
        "--input",
        default="null",
        help="JSON input value passed to the agent. Defaults to null.",
    )

    return parser


def _validate(agents: str) -> int:
    manifests = load_manifests_from_dir(agents)
    available = set(manifests)
    errors: list[str] = []
    for manifest in manifests.values():
        for error in validate_manifest(manifest, available_agents=available):
            errors.append(f"{manifest.id}: {error}")

    if errors:
        for error in errors:
            print(error)
        return 1

    print(f"Validated {len(manifests)} agent manifest(s).")
    return 0


def _run(agents: str, agent_id: str, input_json: str) -> int:
    try:
        input_value: Any = json.loads(input_json)
    except json.JSONDecodeError as exc:
        print(f"Invalid --input JSON: {exc}")
        return 1

    client = agntz(agents=agents, model_provider=LiteLLMModelProvider())
    result = client.agents.run(agent_id=agent_id, input=input_value)
    print(json.dumps(result.model_dump(by_alias=True), indent=2, sort_keys=True))
    return 0
