"""Built-in LLM reasoner for memrez."""

from __future__ import annotations

import importlib
import json
import os
import warnings
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Protocol, cast

from .core import format_litellm_model
from .memrez import (
    DEFAULT_CORE_TOPIC,
    EntryType,
    MemoryEntry,
    MemoryTopicConfig,
    TaggerInput,
    TaggerResult,
    deterministic_tag,
    normalize_topic_config,
)


@dataclass(frozen=True)
class ReasonerModelConfig:
    provider: str
    name: str


DEFAULT_TAGGER_MODEL = ReasonerModelConfig(provider="openai", name="gpt-5.4-mini")
DEFAULT_CURATOR_MODEL = ReasonerModelConfig(provider="openai", name="gpt-5.4")


class ReasonerModelProvider(Protocol):
    def generate_text(
        self,
        *,
        model: ReasonerModelConfig,
        messages: Sequence[Mapping[str, str]],
        output_schema: Mapping[str, Any],
    ) -> str: ...


class MemrezReasonerSetupError(RuntimeError):
    pass


TAGGER_INSTRUCTION = """You normalize one memory fact.

Choose the most specific allowed namespace for the fact, assign concise
lowercase topics, and return strict JSON matching the schema. Never invent
data beyond the supplied content.

Reuse existing topics when one fits; only mint a new topic when none do.
Prefer configured preferred topics when they fit.

The configured core topic marks the always-load set: durable profile facts
an agent should know without searching (equipment, schedule, goals, hard
constraints). Add the exact configured core topic alongside the subject topic
for such facts, e.g. ["equipment", "core"] when the configured core topic is
"core". Never mark transient events or one-off details as core."""

TAGGER_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "namespace": {"type": "string"},
        "topics": {"type": "array", "items": {"type": "string"}},
        "type": {"type": "string", "enum": ["fact", "preference", "event", "summary"]},
        "normalizedContent": {"type": "string"},
        "duplicateOf": {"type": ["string", "null"]},
    },
    "required": ["namespace", "topics", "type", "normalizedContent"],
    "additionalProperties": False,
}

CURATOR_INSTRUCTION = """You curate a bounded memory slice.

Return strict JSON with an ops array. Use supersede operations to merge
duplicates or reconcile contradictions. Use setBlurb operations to keep
topic summaries short and useful. Operate only inside the supplied grants.

A supersede op is {"type":"supersede","ids":[...],"replacement":{"namespace":string,
"content":string,"topics":[string],"entryType":"fact"|"preference"|"event"|"summary"}}.
A setBlurb op is {"type":"setBlurb","scope":string,"topic":string,"blurb":string}.

Supersede accumulated `event` entries into a compact `summary` entry once
they stop carrying individual value, so scopes stay small.

The configured core topic is the always-load set of durable profile facts.
You own its hygiene: when superseding, add the configured core topic to
replacement topics to promote a durable fact, or omit it to demote one that
no longer earns always-load status. Keep the core topic blurb a one-line
profile of the scope (e.g. "3x/week, dumbbells only, goal: strength")."""

CURATOR_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"ops": {"type": "array", "items": {"type": "object"}}},
    "required": ["ops"],
    "additionalProperties": False,
}

PROVIDER_ENV_KEYS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_GENERATIVE_AI_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "xai": "XAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


class LiteLLMReasonerModelProvider:
    """Sync LiteLLM adapter for memrez's bounded structured calls."""

    def generate_text(
        self,
        *,
        model: ReasonerModelConfig,
        messages: Sequence[Mapping[str, str]],
        output_schema: Mapping[str, Any],
    ) -> str:
        try:
            litellm: Any = importlib.import_module("litellm")
        except ImportError as exc:
            raise MemrezReasonerSetupError(
                "Install agntz[litellm] to use memrez's LLM reasoner"
            ) from exc

        response = litellm.completion(
            model=format_litellm_model(model.provider, model.name),
            messages=[dict(message) for message in messages],
            response_format={
                "type": "json_schema",
                "json_schema": dict(output_schema),
            },
        )
        return _response_text(response)


class LlmReasoner:
    def __init__(
        self,
        *,
        model_provider: ReasonerModelProvider | None = None,
        tagger_model: ReasonerModelConfig | None = None,
        curator_model: ReasonerModelConfig | None = None,
    ) -> None:
        self._using_env_keys = model_provider is None
        self._model_provider = model_provider or LiteLLMReasonerModelProvider()
        self._tagger_model = tagger_model or DEFAULT_TAGGER_MODEL
        self._curator_model = curator_model or DEFAULT_CURATOR_MODEL

    def tag(self, input_value: TaggerInput) -> TaggerResult:
        assert_provider_key(self._tagger_model, self._using_env_keys)
        try:
            text = self._model_provider.generate_text(
                model=self._tagger_model,
                messages=[
                    {"role": "system", "content": TAGGER_INSTRUCTION},
                    {"role": "user", "content": render_tagger_prompt(input_value)},
                ],
                output_schema={"name": "memrez_tag", "schema": dict(TAGGER_OUTPUT_SCHEMA)},
            )
            return parse_tagger_output(text)
        except MemrezReasonerSetupError:
            raise
        except Exception as exc:
            warnings.warn(
                "[memrez] tagger model call failed, falling back to deterministic "
                f"tagging: {exc}",
                RuntimeWarning,
                stacklevel=2,
            )
            return deterministic_tag(input_value)

    def curate(self, input_value: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        assert_provider_key(self._curator_model, self._using_env_keys)
        text = self._model_provider.generate_text(
            model=self._curator_model,
            messages=[
                {"role": "system", "content": CURATOR_INSTRUCTION},
                {"role": "user", "content": render_curator_prompt(input_value)},
            ],
            output_schema={"name": "memrez_curate", "schema": dict(CURATOR_OUTPUT_SCHEMA)},
        )
        return parse_curator_output(text)


def llm_reasoner(
    *,
    model_provider: ReasonerModelProvider | None = None,
    tagger_model: ReasonerModelConfig | None = None,
    curator_model: ReasonerModelConfig | None = None,
) -> LlmReasoner:
    return LlmReasoner(
        model_provider=model_provider,
        tagger_model=tagger_model,
        curator_model=curator_model,
    )


def assert_provider_key(model: ReasonerModelConfig, using_env_keys: bool) -> None:
    if not using_env_keys:
        return
    env_key = PROVIDER_ENV_KEYS.get(model.provider)
    if env_key is None or os.environ.get(env_key):
        return
    raise RuntimeError(
        "memrez's default reasoner needs "
        f"{env_key} for model {model.provider}/{model.name}. Set the env var, "
        "or pass create_memrez(reasoner=...) to supply your own reasoner."
    )


def render_tagger_prompt(input_value: TaggerInput) -> str:
    topic_config = normalize_topic_config(input_value.topic_config)
    return "\n".join(
        [
            "Grants:",
            json.dumps(input_value.grants),
            "",
            "Write policy:",
            json.dumps(asdict(input_value.write_policy)),
            "",
            "Existing topics:",
            json.dumps(input_value.existing_topics),
            "",
            "Core topic:",
            json.dumps(topic_config.core),
            "",
            "Preferred topics:",
            json.dumps(list(topic_config.preferred)),
            "",
            "Topic hints:",
            json.dumps(input_value.topics_hint or []),
            "",
            "Content:",
            input_value.content,
        ]
    )


def render_curator_prompt(input_value: Mapping[str, Any]) -> str:
    topic_config = _resolve_curator_topic_config(input_value.get("topicConfig"))
    entries = input_value.get("entries", [])
    entry_payload = [
        _entry_to_prompt_dict(entry)
        for entry in entries
        if isinstance(entry, MemoryEntry)
    ]
    return "\n".join(
        [
            "Grants:",
            json.dumps(input_value.get("grants", [])),
            "",
            "Scope paths:",
            json.dumps(input_value.get("scopePaths", [])),
            "",
            "Topics:",
            json.dumps(input_value.get("topics") or []),
            "",
            "Core topic:",
            json.dumps(topic_config.core),
            "",
            "Preferred topics:",
            json.dumps(list(topic_config.preferred)),
            "",
            "Entries:",
            json.dumps(entry_payload, indent=2),
        ]
    )


def parse_tagger_output(text: str) -> TaggerResult:
    parsed = _parse_json(text, "tagger")
    if not isinstance(parsed, Mapping):
        raise RuntimeError("memrez tagger returned invalid output shape")

    namespace = parsed.get("namespace")
    topics = parsed.get("topics")
    entry_type = parsed.get("type")
    normalized_content = parsed.get("normalizedContent")
    if (
        not isinstance(namespace, str)
        or not isinstance(topics, list)
        or not all(isinstance(topic, str) for topic in topics)
        or entry_type not in {"fact", "preference", "event", "summary"}
        or not isinstance(normalized_content, str)
    ):
        raise RuntimeError("memrez tagger returned invalid output shape")
    duplicate_of = parsed.get("duplicateOf")
    return TaggerResult(
        namespace=namespace,
        topics=cast(list[str], topics),
        type=cast(EntryType, entry_type),
        normalized_content=normalized_content,
        duplicate_of=duplicate_of if isinstance(duplicate_of, str) and duplicate_of else None,
    )


def parse_curator_output(text: str) -> list[Mapping[str, Any]]:
    parsed = _parse_json(text, "curator")
    if not isinstance(parsed, Mapping) or not isinstance(parsed.get("ops"), list):
        raise RuntimeError("memrez curator returned invalid output: expected { ops: [] }")
    return cast(list[Mapping[str, Any]], parsed["ops"])


def _parse_json(text: str, who: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"memrez {who} returned non-JSON output") from exc


def _resolve_curator_topic_config(value: Any) -> MemoryTopicConfig:
    if value is None:
        return MemoryTopicConfig(core=DEFAULT_CORE_TOPIC)
    if isinstance(value, MemoryTopicConfig):
        return normalize_topic_config(value)
    if isinstance(value, Mapping):
        return normalize_topic_config(value)
    return MemoryTopicConfig(core=DEFAULT_CORE_TOPIC)


def _entry_to_prompt_dict(entry: MemoryEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "scope": entry.scope,
        "content": entry.content,
        "topics": list(entry.topics),
        "type": entry.type,
        "status": entry.status,
        "createdAt": entry.created_at,
        "updatedAt": entry.updated_at,
        "source": dict(entry.source) if entry.source else None,
        "supersededBy": entry.superseded_by,
    }


def _response_text(response: Any) -> str:
    try:
        return str(response.choices[0].message.content or "")
    except (AttributeError, IndexError, KeyError, TypeError):
        pass

    if isinstance(response, Mapping):
        choices = response.get("choices")
        if isinstance(choices, list) and choices:
            choice = choices[0]
            if isinstance(choice, Mapping):
                message = choice.get("message")
                if isinstance(message, Mapping):
                    content = message.get("content")
                    return content if isinstance(content, str) else ""
    return ""
