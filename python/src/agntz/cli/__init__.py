"""Command line entrypoints for Agntz."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from agntz.core import LiteLLMModelProvider
from agntz.manifest import (
    find_manifest_files,
    load_manifest_file,
    load_manifests_from_dir,
    validate_manifest,
)
from agntz.sdk import agntz


def main() -> None:
    raise SystemExit(run_cli())


def run_cli(argv: Sequence[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "validate":
        return _validate(args.target, json_output=args.json)
    if args.command == "run":
        return _run(args.target, args.agent_id, args.input)

    parser.print_help()
    return 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agntz-py")
    subparsers = parser.add_subparsers(dest="command")

    validate = subparsers.add_parser("validate", help="Validate agent YAML files")
    validate.add_argument(
        "target",
        nargs="?",
        default="./agents",
        help="YAML file or directory. Defaults to ./agents.",
    )
    validate.add_argument("--json", action="store_true", help="Print a JSON report")

    run = subparsers.add_parser("run", help="Run a local agent from YAML")
    run.add_argument("target", help="YAML file or directory")
    run.add_argument("agent_id", nargs="?", help="Agent id when target is a directory")
    run.add_argument(
        "--input",
        default="null",
        help="JSON input value passed to the agent. Defaults to null.",
    )

    return parser


def _validate(target: str, *, json_output: bool = False) -> int:
    target_path = Path(target)
    try:
        if not target_path.exists():
            raise FileNotFoundError(f"Validation target not found: {target_path}")
        if target_path.is_file():
            if target_path.suffix.lower() not in {".yaml", ".yml"}:
                raise ValueError(
                    f"Validation target must be a YAML file or directory: {target_path}"
                )
            manifest = load_manifest_file(target_path)
            manifest_items = [(target_path, manifest)]
            manifests = {manifest.id: manifest}
        else:
            manifest_items = []
            manifests = {}
            for manifest_path in find_manifest_files(target_path):
                manifest = load_manifest_file(manifest_path)
                if manifest.id in manifests:
                    raise ValueError(
                        f"Duplicate agent id '{manifest.id}' in {manifest_path}"
                    )
                manifests[manifest.id] = manifest
                manifest_items.append((manifest_path, manifest))
            if not manifest_items:
                raise ValueError(f"No YAML agent manifests found below {target_path}")
    except Exception as exc:
        global_errors = [{"path": str(target_path), "message": str(exc)}]
        if json_output:
            print(
                json.dumps(
                    {
                        "valid": False,
                        "errors": global_errors,
                        "files": [],
                        "counts": {"files": 0, "errors": 1, "warnings": 0},
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
        else:
            print(str(exc))
        return 1

    available = set(manifests)
    reports: list[dict[str, Any]] = []
    for manifest_path, manifest in manifest_items:
        errors = validate_manifest(manifest, available_agents=available)
        reports.append(
            {
                "path": str(manifest_path),
                "id": manifest.id,
                "valid": not errors,
                "errors": [
                    {"level": "reference", "path": "", "message": error} for error in errors
                ],
                "warnings": [],
            }
        )

    error_count = sum(len(report["errors"]) for report in reports)
    output = {
        "valid": error_count == 0,
        "errors": [],
        "files": reports,
        "counts": {"files": len(reports), "errors": error_count, "warnings": 0},
    }
    if json_output:
        print(json.dumps(output, indent=2, sort_keys=True))
        return 0 if error_count == 0 else 1

    if error_count:
        for report in reports:
            for error in report["errors"]:
                print(f"{report['id']}: {error['message']}")
        return 1

    print(f"Validated {len(manifests)} agent manifest(s).")
    return 0


def _run(target: str, agent_id: str | None, input_json: str) -> int:
    try:
        input_value: Any = json.loads(input_json)
    except json.JSONDecodeError as exc:
        print(f"Invalid --input JSON: {exc}")
        return 1

    target_path = Path(target)
    if target_path.is_file():
        manifest = load_manifest_file(target_path)
        agents = str(target_path.parent)
        resolved_agent_id = manifest.id
    else:
        agents = str(target_path)
        manifests = load_manifests_from_dir(target_path)
        if agent_id:
            resolved_agent_id = agent_id
        elif len(manifests) == 1:
            resolved_agent_id = next(iter(manifests))
        else:
            print("Directory targets with multiple manifests require an agent id.")
            return 1

    client = agntz(agents=agents, model_provider=LiteLLMModelProvider())
    result = client.agents.run(agent_id=resolved_agent_id, input=input_value)
    print(json.dumps(result.model_dump(by_alias=True), indent=2, sort_keys=True))
    return 0
