"""agntz-backed memrez reasoner for Python."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol, cast

from .memrez import (
    EntryType,
    MemoryTopicConfig,
    TaggerInput,
    TaggerResult,
    WritePolicy,
    normalize_topic_config,
)


class AgntzAgentsResourceLike(Protocol):
    def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> Any: ...


class AgntzClientLike(Protocol):
    @property
    def agents(self) -> AgntzAgentsResourceLike: ...


class AgntzReasoner:
    def __init__(
        self,
        *,
        client: AgntzClientLike,
        tagger_agent_id: str = "memrez-tagger",
        curator_agent_id: str = "memrez-curator",
    ) -> None:
        self.client = client
        self.tagger_agent_id = tagger_agent_id
        self.curator_agent_id = curator_agent_id

    def tag(self, input_value: TaggerInput) -> TaggerResult:
        result = self.client.agents.run(
            agent_id=self.tagger_agent_id,
            input={
                "grants": input_value.grants,
                "content": input_value.content,
                "existingTopics": input_value.existing_topics,
                "topicsHint": input_value.topics_hint or [],
                "topicConfig": _topic_config_to_dict(input_value.topic_config),
                "writePolicy": _write_policy_to_dict(input_value.write_policy),
                "source": input_value.source or None,
            },
        )
        return _parse_tagger_result(_result_output(result))

    def curate(self, input_value: dict[str, Any]) -> list[dict[str, Any]]:
        result = self.client.agents.run(
            agent_id=self.curator_agent_id,
            input={
                "grants": input_value.get("grants", []),
                "scopePaths": input_value.get("scopePaths", []),
                "entries": input_value.get("entries", []),
                "topics": input_value.get("topics", []),
                "topicConfig": input_value.get("topicConfig"),
            },
        )
        parsed = _parse_output(_result_output(result))
        if not isinstance(parsed, dict) or not isinstance(parsed.get("ops"), list):
            raise ValueError("memrez curator returned invalid output: expected { ops: [] }")
        return [dict(op) for op in parsed["ops"] if isinstance(op, dict)]


def agntz_reasoner(
    *,
    client: AgntzClientLike,
    tagger_agent_id: str = "memrez-tagger",
    curator_agent_id: str = "memrez-curator",
) -> AgntzReasoner:
    return AgntzReasoner(
        client=client,
        tagger_agent_id=tagger_agent_id,
        curator_agent_id=curator_agent_id,
    )


def memrez_agents_path() -> Path:
    repo_agents = Path(__file__).resolve().parents[3] / "packages" / "memrez" / "agents"
    if repo_agents.exists() and any(
        path.suffix.lower() in {".yaml", ".yml"} for path in repo_agents.rglob("*")
    ):
        return repo_agents
    raise FileNotFoundError("Could not find canonical memrez agent manifests")


def _result_output(result: Any) -> Any:
    if hasattr(result, "output"):
        return result.output
    if isinstance(result, dict):
        return result.get("output")
    return result


def _parse_tagger_result(output: Any) -> TaggerResult:
    parsed = _parse_output(output)
    if not isinstance(parsed, dict):
        raise ValueError("memrez tagger returned invalid output: expected object")
    namespace = parsed.get("namespace")
    topics = parsed.get("topics")
    entry_type = parsed.get("type")
    normalized_content = parsed.get("normalizedContent", parsed.get("normalized_content"))
    duplicate_of = parsed.get("duplicateOf", parsed.get("duplicate_of"))
    if (
        not isinstance(namespace, str)
        or not isinstance(topics, list)
        or not all(isinstance(topic, str) for topic in topics)
        or not isinstance(entry_type, str)
        or not isinstance(normalized_content, str)
    ):
        raise ValueError("memrez tagger returned invalid output shape")
    return TaggerResult(
        namespace=namespace,
        topics=topics,
        type=_entry_type(entry_type),
        normalized_content=normalized_content,
        duplicate_of=duplicate_of if isinstance(duplicate_of, str) else None,
    )


def _parse_output(output: Any) -> Any:
    if isinstance(output, str):
        return json.loads(output)
    return output


def _entry_type(value: str) -> EntryType:
    if value in {"fact", "preference", "event", "summary"}:
        return cast(EntryType, value)
    raise ValueError(f"memrez tagger returned invalid entry type: {value}")


def _write_policy_to_dict(policy: WritePolicy) -> dict[str, Any]:
    return {
        "descendants": policy.descendants,
        "ancestorPromotion": policy.ancestor_promotion,
    }


def _topic_config_to_dict(topic_config: MemoryTopicConfig | None) -> dict[str, Any]:
    normalized = normalize_topic_config(topic_config)
    return {"core": normalized.core, "preferred": list(normalized.preferred)}
