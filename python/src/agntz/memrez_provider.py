"""Memory resource provider for the Python local SDK."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .core import (
    ResourceMode,
    ResourceProviderToolDefinition,
    ResourceRegistrationContext,
    ResourceToolContext,
)
from .memrez import EntryType, Memrez, Source


class MemoryReadInput(BaseModel):
    topic: str
    limit: int | None = None


class MemoryWriteInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    content: str
    type: EntryType | None = None
    topics_hint: list[str] | None = Field(default=None, alias="topicsHint")


class MemoryResourceProvider:
    default_mode: ResourceMode = "read-write"

    def __init__(self, memrez: Memrez) -> None:
        self.memrez = memrez

    def get_context(self, ctx: ResourceToolContext) -> str | None:
        if _config_value(ctx.config, "autoScan") is False:
            return None
        scan = self.memrez.scan(ctx.grants)
        topics = scan["topics"]
        if not topics:
            return "Memory topics: none."
        lines: list[str] = []
        for topic in topics:
            blurb = f" - {topic.blurb}" if topic.blurb else ""
            lines.append(f"- {topic.topic} ({topic.count}){blurb}")
        return "Memory topics visible to this run:\n" + "\n".join(lines)

    def tools(
        self,
        ctx: ResourceRegistrationContext,
    ) -> list[ResourceProviderToolDefinition]:
        return [
            ResourceProviderToolDefinition(
                name="read",
                description="Read memory entries for a topic visible to this run.",
                input_schema=MemoryReadInput,
                execute=self._read,
            ),
            ResourceProviderToolDefinition(
                name="write",
                description=(
                    "Write a durable memory fact. The memory resource chooses "
                    "and validates the namespace."
                ),
                input_schema=MemoryWriteInput,
                execute=self._write,
                mode="read-write",
            ),
        ]

    def _read(self, ctx: ResourceToolContext, input_value: MemoryReadInput) -> Any:
        return self.memrez.read(
            ctx.grants,
            input_value.topic,
            limit=input_value.limit,
        )

    def _write(self, ctx: ResourceToolContext, input_value: MemoryWriteInput) -> Any:
        return self.memrez.write(
            ctx.grants,
            input_value.content,
            type=input_value.type,
            topics_hint=input_value.topics_hint,
            write_policy=_config_value(ctx.config, "writePolicy"),
            source=_source_from_run(ctx.run),
        )


def create_memory_resource_provider(memrez: Memrez) -> MemoryResourceProvider:
    return MemoryResourceProvider(memrez)


def _config_value(config: Any, key: str) -> Any:
    extra = getattr(config, "model_extra", None)
    if isinstance(extra, dict) and key in extra:
        return extra[key]
    if isinstance(config, dict):
        return config.get(key)
    return getattr(config, key, None)


def _source_from_run(run: dict[str, str | None]) -> Source:
    source: Source = {}
    for key in ("agentId", "sessionId", "runId"):
        value = run.get(key)
        if value is not None:
            source[key] = value
    return source
