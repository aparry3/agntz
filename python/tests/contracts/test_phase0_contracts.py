from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "contracts" / "python-port"


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = yaml.safe_load(handle)
    assert isinstance(value, dict)
    return value


def _load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    assert isinstance(value, dict)
    return value


def _state_key(agent_id: str) -> str:
    parts = [part for part in agent_id.split("-") if part]
    if not parts:
        return agent_id
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def test_manifest_kind_contract_fixtures_match_yaml() -> None:
    expectations = _load_json(CONTRACTS / "expectations" / "manifest-kinds.json")

    for filename, expected in expectations.items():
        manifest = _load_yaml(CONTRACTS / "manifests" / filename)
        assert manifest["id"] == expected["id"]
        assert manifest["kind"] == expected["kind"]
        assert manifest.get("stateKey") or _state_key(manifest["id"]) == expected["stateKey"]

        if "model" in expected:
            assert manifest["model"]["provider"] == expected["model"]["provider"]
            assert manifest["model"]["name"] == expected["model"]["name"]

        if "outputSchema" in expected:
            assert manifest["outputSchema"] == expected["outputSchema"]

        if "stepKeys" in expected:
            assert [step["stateKey"] for step in manifest["steps"]] == expected["stepKeys"]

        if "branchKeys" in expected:
            assert [step["stateKey"] for step in manifest["branches"]] == expected["branchKeys"]


def test_client_wire_contract_pins_hosted_request_and_stream_shape() -> None:
    contract = _load_json(CONTRACTS / "expectations" / "client-wire.json")

    assert contract["runRequest"]["method"] == "POST"
    assert contract["runRequest"]["path"] == "/run"
    assert contract["runRequest"]["body"] == {
        "agentId": "support",
        "input": "hello",
        "sessionId": "sess_abc",
    }
    assert contract["streamRequest"]["path"] == "/run/stream"
    assert contract["streamRequest"]["accept"] == "text/event-stream"
    assert [event["normalizedType"] for event in contract["streamEvents"]] == [
        "start",
        "reply",
        "complete",
    ]


def test_python_package_has_phase0_version() -> None:
    import agntz

    assert agntz.__version__ == "0.1.0"
