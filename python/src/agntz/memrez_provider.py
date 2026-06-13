"""Memory resource provider for the Python local SDK."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from pydantic import BaseModel, ConfigDict, Field

from .core import (
    ResourceMode,
    ResourceProviderToolDefinition,
    ResourceRegistrationContext,
    ResourceToolContext,
)
from .memrez import (
    EntryType,
    MemoryEntry,
    MemoryTopicConfig,
    Memrez,
    Source,
    normalize_topic_config,
)

DEFAULT_PRELOAD_LIMIT = 50
MAX_PRELOAD_LIMIT = 200
DEFAULT_PRELOAD_MAX_CHARS = 12_000
MAX_PRELOAD_MAX_CHARS = 50_000
DEFAULT_ALL_PRELOAD_TYPES: list[EntryType] = ["fact", "preference", "summary"]
ENTRY_TYPES: set[str] = {"fact", "preference", "event", "summary"}


class MemoryReadInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topics: str | list[str] | None = Field(
        default=None,
        description="Topic or list of topics to read from memory.",
    )
    topic: str | None = Field(
        default=None,
        description="Single topic to read (legacy alias of topics).",
    )
    limit: int | None = Field(default=None, gt=0, le=50)


class MemoryWriteInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str = Field(description="Finished fact or preference to remember.")


@dataclass(frozen=True)
class NormalizedPreloadConfig:
    all: bool
    topics: list[str]
    limit: int
    max_chars: int
    types: list[EntryType] | None = None


class MemoryResourceProvider:
    default_mode: ResourceMode = "read-write"

    def __init__(self, memrez: Memrez) -> None:
        self.memrez = memrez

    def get_context(self, ctx: ResourceToolContext) -> str | None:
        topic_config = _topic_config_from_config(ctx.config)
        sections: list[str] = []

        if _config_value(ctx.config, "autoScan") is not False:
            scan = self.memrez.scan(ctx.grants)
            topics = scan["topics"]
            if not topics:
                sections.append("Memory topics: none.")
            else:
                lines: list[str] = []
                for topic in topics:
                    blurb = f" - {topic.blurb}" if topic.blurb else ""
                    lines.append(f"- {topic.topic} ({topic.count}){blurb}")
                sections.append("Memory topics visible to this run:\n" + "\n".join(lines))

        preload = _normalize_preload_config(ctx.config, topic_config)
        if preload is not None:
            preloaded = _preload_entries(self.memrez, ctx, preload)
            if preloaded:
                sections.append(preloaded)

        return "\n\n".join(sections) if sections else None

    def tools(
        self,
        ctx: ResourceRegistrationContext,
    ) -> list[ResourceProviderToolDefinition]:
        return [
            ResourceProviderToolDefinition(
                name="read",
                description="Read memory entries for one or more topics visible to this run.",
                input_schema=MemoryReadInput,
                execute=self._read,
            ),
            ResourceProviderToolDefinition(
                name="write",
                description=(
                    "Remember something durable. Memory organization (namespace, topics, "
                    "type) is handled for you; just pass the finished content."
                ),
                input_schema=MemoryWriteInput,
                execute=self._write,
                mode="read-write",
            ),
        ]

    def _read(self, ctx: ResourceToolContext, input_value: MemoryReadInput) -> Any:
        topics = _normalize_read_topics(input_value)
        if not topics:
            raise ValueError("memory_read requires `topics` (string or array of strings)")
        return self.memrez.read(
            ctx.grants,
            topics,
            limit=input_value.limit,
        )

    def _write(self, ctx: ResourceToolContext, input_value: MemoryWriteInput) -> Any:
        return self.memrez.write(
            ctx.grants,
            input_value.content,
            topic_config=_topic_config_from_config(ctx.config),
            write_policy=_config_value(ctx.config, "writePolicy"),
            source=_source_from_run(ctx.run),
        )


def create_memory_resource_provider(memrez: Memrez) -> MemoryResourceProvider:
    return MemoryResourceProvider(memrez)


def _normalize_read_topics(input_value: MemoryReadInput) -> list[str]:
    raw = input_value.topics if input_value.topics is not None else input_value.topic
    if raw is None:
        return []
    topics = [raw] if isinstance(raw, str) else list(raw)
    return [topic.strip() for topic in topics if topic.strip()]


def _preload_entries(
    memrez: Memrez,
    ctx: ResourceToolContext,
    preload: NormalizedPreloadConfig,
) -> str | None:
    entries = memrez.list(
        ctx.grants,
        topics=None if preload.all else preload.topics,
    )
    selected = (
        [entry for entry in entries if entry.type in preload.types]
        if preload.types is not None
        else entries
    )
    if not selected:
        return None

    rendered = _render_preloaded_entries(selected, preload)
    if not rendered["lines"]:
        return None
    omitted = len(selected) - int(rendered["shown"])
    lines = list(cast(list[str], rendered["lines"]))
    if omitted > 0:
        lines.append(f"... {omitted} more entries not shown; use memory_read.")
    return "Preloaded memory entries (most recent first):\n" + "\n".join(lines)


def _format_preloaded_entry(entry: MemoryEntry) -> str:
    return f"- [{', '.join(entry.topics)}] {entry.content}"


def _render_preloaded_entries(
    entries: list[MemoryEntry],
    preload: NormalizedPreloadConfig,
) -> dict[str, Any]:
    lines: list[str] = []
    used = 0
    shown = 0
    for entry in entries:
        if shown >= preload.limit:
            break
        raw_line = _format_preloaded_entry(entry)
        separator = "" if not lines else "\n"
        next_length = used + len(separator) + len(raw_line)
        if next_length <= preload.max_chars:
            lines.append(raw_line)
            used = next_length
            shown += 1
            continue
        remaining = preload.max_chars - used - len(separator)
        if remaining > 20 and not lines:
            lines.append(f"{raw_line[: remaining - 3]}...")
            shown += 1
        break
    return {"lines": lines, "shown": shown}


def _topic_config_from_config(config: Any) -> MemoryTopicConfig:
    raw = _config_value(config, "topics")
    if raw is None:
        return normalize_topic_config(None)
    _assert_plain_object(raw, "memory.topics")
    _reject_unknown_keys(raw, ["core", "preferred"], "memory.topics")
    return normalize_topic_config(raw)


def _normalize_preload_config(
    config: Any,
    topic_config: MemoryTopicConfig,
) -> NormalizedPreloadConfig | None:
    raw = _config_value(config, "preload")
    if raw is None or raw is False:
        return None

    legacy_limit_raw = _config_value(config, "preloadLimit")
    legacy_limit = (
        None
        if legacy_limit_raw is None
        else _normalize_positive_int(
            legacy_limit_raw,
            "memory.preloadLimit",
            MAX_PRELOAD_LIMIT,
        )
    )

    if raw is True:
        return NormalizedPreloadConfig(
            all=False,
            topics=[topic_config.core],
            limit=legacy_limit or DEFAULT_PRELOAD_LIMIT,
            max_chars=DEFAULT_PRELOAD_MAX_CHARS,
        )

    if raw == "all":
        return NormalizedPreloadConfig(
            all=True,
            topics=[],
            limit=legacy_limit or DEFAULT_PRELOAD_LIMIT,
            max_chars=DEFAULT_PRELOAD_MAX_CHARS,
            types=list(DEFAULT_ALL_PRELOAD_TYPES),
        )

    if isinstance(raw, str):
        raise ValueError('memory.preload string value must be "all"')

    if isinstance(raw, list):
        topics = _unique_topics(
            [topic_config.core, *_normalize_topic_list(raw, "memory.preload")]
        )
        return NormalizedPreloadConfig(
            all=False,
            topics=topics,
            limit=legacy_limit or DEFAULT_PRELOAD_LIMIT,
            max_chars=DEFAULT_PRELOAD_MAX_CHARS,
        )

    _assert_plain_object(raw, "memory.preload")
    _reject_unknown_keys(
        raw,
        ["core", "topics", "limit", "maxChars", "types"],
        "memory.preload",
    )

    core = raw.get("core", False)
    if not isinstance(core, bool):
        raise ValueError("memory.preload.core must be boolean when provided")

    raw_topics = raw.get("topics")
    all_topics = raw_topics == "all"
    if raw_topics is not None and raw_topics != "all" and not isinstance(raw_topics, list):
        raise ValueError('memory.preload.topics must be "all" or a topic array')

    configured_topics = (
        []
        if raw_topics is None or raw_topics == "all"
        else _normalize_topic_list(raw_topics, "memory.preload.topics")
    )
    core_topics = [topic_config.core] if core else []
    topics = _unique_topics([*core_topics, *configured_topics])
    if not all_topics and not topics:
        return None

    raw_limit = raw.get("limit")
    raw_max_chars = raw.get("maxChars")
    raw_types = raw.get("types")
    return NormalizedPreloadConfig(
        all=all_topics,
        topics=topics,
        limit=(
            legacy_limit or DEFAULT_PRELOAD_LIMIT
            if raw_limit is None
            else _normalize_positive_int(raw_limit, "memory.preload.limit", MAX_PRELOAD_LIMIT)
        ),
        max_chars=(
            DEFAULT_PRELOAD_MAX_CHARS
            if raw_max_chars is None
            else _normalize_positive_int(
                raw_max_chars,
                "memory.preload.maxChars",
                MAX_PRELOAD_MAX_CHARS,
            )
        ),
        types=(
            list(DEFAULT_ALL_PRELOAD_TYPES)
            if raw_types is None and all_topics
            else None
            if raw_types is None
            else _normalize_entry_types(raw_types)
        ),
    )


def _normalize_positive_int(value: Any, path: str, max_value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"{path} must be a positive integer")
    return min(value, max_value)


def _normalize_entry_types(raw: Any) -> list[EntryType]:
    if not isinstance(raw, list) or not raw:
        raise ValueError("memory.preload.types must be a non-empty entry type array")
    output: list[EntryType] = []
    for value in raw:
        if not isinstance(value, str) or value not in ENTRY_TYPES:
            raise ValueError(
                "memory.preload.types must contain only fact, preference, event, or summary"
            )
        typed = cast(EntryType, value)
        if typed not in output:
            output.append(typed)
    return output


def _normalize_topic_list(raw: Any, path: str) -> list[str]:
    if not isinstance(raw, list):
        raise ValueError(f"{path} must be an array of topic strings")
    return _unique_topics(
        [_normalize_topic_name(topic, f"{path}[{index}]") for index, topic in enumerate(raw)]
    )


def _normalize_topic_name(raw: Any, path: str) -> str:
    if not isinstance(raw, str):
        raise ValueError(f"{path} must be a topic string")
    topic = raw.strip().lower()
    if not topic:
        raise ValueError(f"{path} must not be empty")
    return topic


def _unique_topics(topics: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for topic in topics:
        if topic in seen:
            continue
        seen.add(topic)
        output.append(topic)
    return output


def _assert_plain_object(value: Any, path: str) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")


def _reject_unknown_keys(value: dict[str, Any], allowed_keys: list[str], path: str) -> None:
    unknown = [key for key in value if key not in allowed_keys]
    if unknown:
        raise ValueError(f"{path} has unsupported keys: {', '.join(unknown)}")


def _config_value(config: Any, key: str) -> Any:
    extra = getattr(config, "model_extra", None)
    if isinstance(extra, dict) and key in extra:
        return extra[key]
    nested = getattr(config, "config", None)
    if isinstance(nested, dict) and key in nested:
        return nested[key]
    if isinstance(config, dict):
        nested = config.get("config")
        if isinstance(nested, dict) and key in nested:
            return nested[key]
        return config.get(key)
    return getattr(config, key, None)


def _source_from_run(run: dict[str, str | None]) -> Source:
    source: Source = {}
    for key in ("agentId", "sessionId", "runId"):
        value = run.get(key)
        if value is not None:
            source[key] = value
    return source
