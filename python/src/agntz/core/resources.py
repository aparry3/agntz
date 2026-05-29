"""Generic resource provider contracts for embedded local execution."""

from __future__ import annotations

import inspect
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel

from agntz.manifest.types import ResourceManifestEntry

ResourceMode = Literal["read", "read-write"]
ResourceExecute = Callable[["ResourceToolContext", Any], Any | Awaitable[Any]]


@dataclass(frozen=True)
class ResourceRegistrationContext:
    resource_name: str
    kind: str
    mode: ResourceMode
    config: ResourceManifestEntry


@dataclass(frozen=True)
class ResourceToolContext:
    resource_name: str
    kind: str
    mode: ResourceMode
    config: ResourceManifestEntry
    grants: list[str]
    run: dict[str, str | None]


@dataclass(frozen=True)
class ResourceProviderToolDefinition:
    name: str
    description: str
    input_schema: type[BaseModel] | dict[str, Any] | None
    execute: ResourceExecute
    mode: ResourceMode = "read"

    async def run(self, params: dict[str, Any], ctx: ResourceToolContext) -> Any:
        value: Any = params
        if isinstance(self.input_schema, type) and issubclass(self.input_schema, BaseModel):
            value = self.input_schema.model_validate(params)
        result = self.execute(ctx, value)
        if inspect.isawaitable(result):
            return await result
        return result


class ResourceProvider(Protocol):
    default_mode: ResourceMode

    def tools(
        self,
        ctx: ResourceRegistrationContext,
    ) -> Sequence[ResourceProviderToolDefinition]: ...

    def get_context(self, ctx: ResourceToolContext) -> str | None | Awaitable[str | None]: ...


@dataclass(frozen=True)
class ResolvedResource:
    name: str
    definition: ResourceManifestEntry
    provider: ResourceProvider
    mode: ResourceMode


def clamp_resource_mode(declared: ResourceMode, parent: ResourceMode | None) -> ResourceMode:
    if parent == "read" or declared == "read":
        return "read"
    return "read-write"


def make_resource_tool_name(resource_name: str, provider_tool_name: str) -> str:
    return f"{resource_tool_prefix(resource_name)}_{provider_tool_name}"


def resource_tool_prefix(resource_name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", resource_name)
