from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from agntz import agntz_reasoner, memrez_agents_path
from agntz.manifest import load_manifests_from_dir
from agntz.memrez import TaggerInput, WritePolicy


@dataclass(frozen=True)
class FakeRunResult:
    output: Any


class FakeAgents:
    def __init__(self, result: FakeRunResult) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> FakeRunResult:
        self.calls.append(
            {
                "agent_id": agent_id,
                "input": input,
                "session_id": session_id,
                "context": context,
            }
        )
        return self.result


class FakeClient:
    def __init__(self, result: FakeRunResult) -> None:
        self.agents = FakeAgents(result)


def test_agntz_reasoner_runs_tagger_and_parses_object_output() -> None:
    client = FakeClient(
        FakeRunResult(
            {
                "namespace": "app/user/u_123",
                "topics": ["prefs"],
                "type": "preference",
                "normalizedContent": "Prefers metric units.",
            }
        )
    )
    reasoner = agntz_reasoner(client=client)

    result = reasoner.tag(
        TaggerInput(
            grants=["app/user/u_123"],
            content="metric please",
            existing_topics=[],
            write_policy=WritePolicy(),
        )
    )

    assert client.agents.calls[0]["agent_id"] == "memrez-tagger"
    assert client.agents.calls[0]["input"]["grants"] == ["app/user/u_123"]
    assert client.agents.calls[0]["input"]["writePolicy"] == {
        "descendants": True,
        "ancestorPromotion": "none",
    }
    assert result.namespace == "app/user/u_123"
    assert result.topics == ["prefs"]
    assert result.type == "preference"
    assert result.normalized_content == "Prefers metric units."


def test_agntz_reasoner_runs_curator_and_parses_json_output() -> None:
    client = FakeClient(
        FakeRunResult(
            json.dumps(
                {
                    "ops": [
                        {
                            "type": "setBlurb",
                            "scope": "app/user/u_123",
                            "topic": "prefs",
                            "blurb": "Preferences.",
                        }
                    ]
                }
            )
        )
    )
    reasoner = agntz_reasoner(client=client)

    ops = reasoner.curate(
        {
            "grants": ["app/user/u_123"],
            "scopePaths": ["app", "app/user", "app/user/u_123"],
            "entries": [],
        }
    )

    assert client.agents.calls[0]["agent_id"] == "memrez-curator"
    assert client.agents.calls[0]["input"]["grants"] == ["app/user/u_123"]
    assert ops == [
        {
            "type": "setBlurb",
            "scope": "app/user/u_123",
            "topic": "prefs",
            "blurb": "Preferences.",
        }
    ]


def test_memrez_agents_path_loads_canonical_manifests() -> None:
    manifests = load_manifests_from_dir(memrez_agents_path())

    assert {"memrez-tagger", "memrez-curator"} <= set(manifests)
