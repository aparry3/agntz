from __future__ import annotations

import importlib
import json
from dataclasses import dataclass
from typing import Any

import pytest

from agntz import agntz_reasoner, memrez_agents_path
from agntz.manifest import load_manifests_from_dir
from agntz.memrez import (
    MemoryEntry,
    MemoryTopicConfig,
    TaggerInput,
    WritePolicy,
    create_memrez,
)
from agntz.memrez_llm_reasoner import LlmReasoner, MemrezReasonerSetupError, llm_reasoner


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


class FakeReasonerModelProvider:
    def __init__(self, *responses: str | Exception) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def generate_text(self, **kwargs: Any) -> str:
        self.calls.append(kwargs)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


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
    assert client.agents.calls[0]["input"]["topicConfig"] == {
        "core": "core",
        "preferred": [],
    }


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
    try:
        manifests = load_manifests_from_dir(memrez_agents_path())
    except FileNotFoundError:
        manifests = {}

    assert manifests == {} or {"memrez-tagger", "memrez-curator"} <= set(manifests)


def test_default_create_memrez_uses_llm_reasoner() -> None:
    memrez = create_memrez()

    assert isinstance(memrez.reasoner, LlmReasoner)


def test_llm_reasoner_tags_with_topic_config_prompt() -> None:
    provider = FakeReasonerModelProvider(
        json.dumps(
            {
                "namespace": "app/user/u_123",
                "topics": ["equipment", "profile"],
                "type": "fact",
                "normalizedContent": "Owns adjustable dumbbells.",
            }
        )
    )
    reasoner = llm_reasoner(model_provider=provider)

    result = reasoner.tag(
        TaggerInput(
            grants=["app/user/u_123"],
            content="has adjustable dumbbells",
            existing_topics=[],
            topic_config=MemoryTopicConfig(core="profile", preferred=("goals", "equipment")),
            write_policy=WritePolicy(),
        )
    )

    assert result.topics == ["equipment", "profile"]
    assert result.normalized_content == "Owns adjustable dumbbells."
    prompt = provider.calls[0]["messages"][1]["content"]
    assert '"profile"' in prompt
    assert '["goals", "equipment"]' in prompt


def test_llm_reasoner_falls_back_to_deterministic_tagging_on_model_failure() -> None:
    reasoner = llm_reasoner(
        model_provider=FakeReasonerModelProvider(RuntimeError("rate limited"))
    )

    with pytest.warns(RuntimeWarning, match="falling back to deterministic"):
        result = reasoner.tag(
            TaggerInput(
                grants=["app/user/u_123"],
                content=" Prefers email. ",
                existing_topics=[],
                topics_hint=["prefs"],
                write_policy=WritePolicy(),
            )
        )

    assert result.namespace == "app/user/u_123"
    assert result.topics == ["prefs"]
    assert result.normalized_content == "Prefers email."


def test_default_llm_reasoner_fails_without_provider_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    reasoner = LlmReasoner()

    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        reasoner.tag(
            TaggerInput(
                grants=["app/user/u_123"],
                content="Prefers email.",
                existing_topics=[],
                write_policy=WritePolicy(),
            )
        )


def test_default_llm_reasoner_does_not_fallback_on_missing_litellm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real_import_module = importlib.import_module

    def fake_import_module(name: str, package: str | None = None) -> Any:
        if name == "litellm":
            raise ImportError("missing")
        return real_import_module(name, package)

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(importlib, "import_module", fake_import_module)

    with pytest.raises(MemrezReasonerSetupError, match=r"agntz\[litellm\]"):
        LlmReasoner().tag(
            TaggerInput(
                grants=["app/user/u_123"],
                content="Prefers email.",
                existing_topics=[],
                topics_hint=["prefs"],
                write_policy=WritePolicy(),
            )
        )


def test_llm_reasoner_curates_and_propagates_failures() -> None:
    entry = MemoryEntry(
        id="mem_1",
        scope="app/user/u_123",
        content="Prefers email.",
        topics=["prefs"],
        type="preference",
        status="active",
        created_at="2026-05-29T00:00:00.000Z",
        updated_at="2026-05-29T00:00:00.000Z",
    )
    provider = FakeReasonerModelProvider(
        json.dumps(
            {
                "ops": [
                    {
                        "type": "setBlurb",
                        "scope": "app/user/u_123",
                        "topic": "prefs",
                        "blurb": "Communication preferences.",
                    }
                ]
            }
        ),
        RuntimeError("boom"),
    )
    reasoner = llm_reasoner(model_provider=provider)

    ops = reasoner.curate(
        {
            "grants": ["app/user/u_123"],
            "scopePaths": ["app", "app/user", "app/user/u_123"],
            "entries": [entry],
            "topicConfig": {"core": "profile", "preferred": ["prefs"]},
        }
    )

    assert ops == [
        {
            "type": "setBlurb",
            "scope": "app/user/u_123",
            "topic": "prefs",
            "blurb": "Communication preferences.",
        }
    ]
    prompt = provider.calls[0]["messages"][1]["content"]
    assert '"profile"' in prompt
    assert '"createdAt": "2026-05-29T00:00:00.000Z"' in prompt

    with pytest.raises(RuntimeError, match="boom"):
        reasoner.curate(
            {
                "grants": ["app/user/u_123"],
                "scopePaths": ["app/user/u_123"],
                "entries": [],
            }
        )
