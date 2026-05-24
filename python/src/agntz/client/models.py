"""Pydantic models for the hosted client wire surface."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AgntzModel(BaseModel):
    """Base model with Python names and TypeScript-compatible aliases."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class Reply(AgntzModel):
    text: str
    ts: str
    session_id: str = Field(alias="sessionId")
    run_id: str = Field(alias="runId")


class RunResult(AgntzModel):
    output: Any = None
    state: dict[str, Any] = Field(default_factory=dict)
    session_id: str = Field(alias="sessionId")
    replies: list[Reply] | None = None


class HealthResult(AgntzModel):
    status: str
    service: str


class Event(AgntzModel):
    type: str
    agent_id: str | None = Field(default=None, alias="agentId")
    kind: str | None = None
    session_id: str | None = Field(default=None, alias="sessionId")
    output: Any = None
    state: dict[str, Any] = Field(default_factory=dict)
    text: str | None = None
    ts: str | None = None
    run_id: str | None = Field(default=None, alias="runId")
    seq: int | None = None
    error: str | None = None
    run: dict[str, Any] | None = None
    span: dict[str, Any] | None = None
    span_id: str | None = Field(default=None, alias="spanId")
    patch: dict[str, Any] | None = None
    summary: dict[str, Any] | None = None
    spans: list[dict[str, Any]] | None = None


class Run(AgntzModel):
    id: str
    root_id: str = Field(alias="rootId")
    agent_id: str = Field(alias="agentId")
    status: str
    input: Any = None
    started_at: int = Field(alias="startedAt")
    parent_id: str | None = Field(default=None, alias="parentId")
    user_id: str | None = Field(default=None, alias="userId")
    session_id: str | None = Field(default=None, alias="sessionId")
    spawn_tool_use_id: str | None = Field(default=None, alias="spawnToolUseId")
    result: dict[str, Any] | None = None
    error: str | None = None
    ended_at: int | None = Field(default=None, alias="endedAt")
    depth: int = 0


class RunListResult(AgntzModel):
    rows: list[Run] = Field(default_factory=list)
    cursor: str | None = None


class Span(AgntzModel):
    span_id: str = Field(alias="spanId")
    trace_id: str = Field(alias="traceId")
    parent_id: str | None = Field(alias="parentId")
    owner_id: str = Field(alias="ownerId")
    run_id: str | None = Field(alias="runId")
    session_id: str | None = Field(alias="sessionId")
    name: str
    kind: str
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(alias="endedAt")
    duration_ms: int | None = Field(alias="durationMs")
    status: str
    error: str | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    events: list[dict[str, Any]] = Field(default_factory=list)
    scores: dict[str, Any] = Field(default_factory=dict)
    cost_usd: float | None = Field(default=None, alias="costUsd")


class TraceSummary(AgntzModel):
    trace_id: str = Field(alias="traceId")
    owner_id: str = Field(alias="ownerId")
    root_name: str = Field(alias="rootName")
    agent_id: str | None = Field(alias="agentId")
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(alias="endedAt")
    duration_ms: int | None = Field(alias="durationMs")
    span_count: int = Field(alias="spanCount")
    status: str
    total_tokens: int = Field(alias="totalTokens")
    total_cost_usd: float | None = Field(alias="totalCostUsd")


class TraceDetail(AgntzModel):
    summary: TraceSummary
    spans: list[Span] = Field(default_factory=list)


class TracesListResult(AgntzModel):
    rows: list[TraceSummary] = Field(default_factory=list)
    cursor: str | None = None
