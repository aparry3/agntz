"""Local tool helpers for embedded execution."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

ToolExecute = Callable[[Any], Any | Awaitable[Any]]


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: type[BaseModel] | dict[str, Any] | None
    execute: ToolExecute

    async def run(self, params: dict[str, Any]) -> Any:
        value: Any = params
        if isinstance(self.input_schema, type) and issubclass(self.input_schema, BaseModel):
            value = self.input_schema.model_validate(params)
        result = self.execute(value)
        if inspect.isawaitable(result):
            return await result
        return result


def tool(
    *,
    name: str,
    description: str,
    input_schema: type[BaseModel] | dict[str, Any] | None = None,
    execute: ToolExecute,
) -> ToolDefinition:
    if not name:
        raise ValueError("tool name is required")
    if not description:
        raise ValueError("tool description is required")
    return ToolDefinition(
        name=name,
        description=description,
        input_schema=input_schema,
        execute=execute,
    )
