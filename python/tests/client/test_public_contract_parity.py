from __future__ import annotations

import inspect
import json
from pathlib import Path

from agntz import AgntzClient
from agntz.client.client import AgentsResource, RunsResource

ROOT = Path(__file__).resolve().parents[3]
CONTRACT = json.loads((ROOT / "contracts" / "hosted-client-parity.json").read_text())


def _camel_to_snake(value: str) -> str:
    result = ""
    for char in value:
        if char.isupper():
            result += "_"
        result += char.lower()
    return result


def test_migration_critical_resource_surface_matches_shared_contract() -> None:
    client = AgntzClient(api_key="test", base_url="https://worker.test")
    try:
        for resource_name, methods in CONTRACT["resources"].items():
            resource = getattr(client, resource_name)
            for method in methods:
                assert callable(getattr(resource, method)), f"{resource_name}.{method}"
    finally:
        client.close()


def test_run_fields_and_vocab_match_shared_contract() -> None:
    run = inspect.signature(AgentsResource.run).parameters
    stream = inspect.signature(AgentsResource.stream).parameters
    start = inspect.signature(RunsResource.start).parameters
    for wire_name in CONTRACT["runRequestFields"]:
        python_name = _camel_to_snake(wire_name)
        assert python_name in run
        assert python_name in stream
        assert python_name in start
    for wire_name in CONTRACT["durableRunFields"]:
        assert _camel_to_snake(wire_name) in start

    assert CONTRACT["version"] == 2
    assert CONTRACT["retentionModes"] == ["none", "result", "session"]
    assert CONTRACT["contentBlockTypes"] == ["text", "image", "audio"]
    assert CONTRACT["agentKinds"] == [
        "llm",
        "tool",
        "sequential",
        "parallel",
        "transcription",
        "image",
    ]
