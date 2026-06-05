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


class ModelConfig(AgntzModel):
    provider: str
    name: str
    temperature: float | None = None
    max_tokens: int | None = Field(default=None, alias="maxTokens")
    top_p: float | None = Field(default=None, alias="topP")
    options: dict[str, Any] | None = None


class AgentDefinition(AgntzModel):
    id: str
    name: str
    description: str | None = None
    version: str | None = None
    system_prompt: str = Field(default="", alias="systemPrompt")
    examples: list[dict[str, Any]] | None = None
    user_prompt_template: str | None = Field(default=None, alias="userPromptTemplate")
    model: ModelConfig = Field(
        default_factory=lambda: ModelConfig(provider="openai", name="gpt-5.4")
    )
    tools: list[dict[str, Any]] | None = None
    spawnable: list[Any] | None = None
    skills: list[str] | None = None
    resources: dict[str, Any] | None = None
    reply: bool | dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = Field(default=None, alias="outputSchema")
    context_write: bool | None = Field(default=None, alias="contextWrite")
    max_steps: int | None = Field(default=None, alias="maxSteps")
    token_budget: int | None = Field(default=None, alias="tokenBudget")
    timeout_ms: int | None = Field(default=None, alias="timeoutMs")
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class AgentListEntry(AgntzModel):
    id: str
    name: str
    description: str | None = None
    kind: str | None = None
    model: str | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class AgentVersionSummary(AgntzModel):
    created_at: str = Field(alias="createdAt")
    activated_at: str | None = Field(default=None, alias="activatedAt")
    aliases: list[str] = Field(default_factory=list)


class ApiKeyRecord(AgntzModel):
    id: str
    user_id: str = Field(alias="userId")
    name: str
    key_prefix: str = Field(alias="keyPrefix")
    created_at: str = Field(alias="createdAt")
    last_used_at: str | None = Field(default=None, alias="lastUsedAt")
    revoked_at: str | None = Field(default=None, alias="revokedAt")


class EvalCriterion(AgntzModel):
    id: str
    name: str
    description: str | None = None
    weight: float | None = None
    threshold: float | None = None


class EvalDefinition(AgntzModel):
    id: str
    agent_id: str = Field(alias="agentId")
    name: str
    description: str | None = None
    criteria: list[EvalCriterion] = Field(default_factory=list)
    default_dataset_id: str | None = Field(default=None, alias="defaultDatasetId")
    pass_threshold: float | None = Field(default=None, alias="passThreshold")
    judge_model: ModelConfig | None = Field(default=None, alias="judgeModel")
    metadata: dict[str, Any] | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class EvalDatasetItem(AgntzModel):
    id: str
    input: Any
    expected: Any = None
    metadata: dict[str, Any] | None = None


class EvalDataset(AgntzModel):
    id: str
    agent_id: str = Field(alias="agentId")
    name: str
    description: str | None = None
    items: list[EvalDatasetItem] = Field(default_factory=list)
    metadata: dict[str, Any] | None = None
    created_at: str | None = Field(default=None, alias="createdAt")
    updated_at: str | None = Field(default=None, alias="updatedAt")


class EvalCriterionResult(AgntzModel):
    score: float
    passed: bool
    reason: str


class EvalCaseResult(AgntzModel):
    item_id: str = Field(alias="itemId")
    status: str
    input: Any
    expected: Any = None
    output: str | None = None
    agent_run_id: str | None = Field(default=None, alias="agentRunId")
    invocation_id: str | None = Field(default=None, alias="invocationId")
    usage: dict[str, int] | None = None
    duration: int | None = None
    criteria: dict[str, EvalCriterionResult] = Field(default_factory=dict)
    score: float
    passed: bool
    reason: str | None = None
    error: str | None = None


class EvalRunSummaryCriterion(AgntzModel):
    score: float
    passed: bool
    completed_cases: int = Field(alias="completedCases")


class EvalRunSummary(AgntzModel):
    total_cases: int = Field(alias="totalCases")
    completed_cases: int = Field(alias="completedCases")
    failed_cases: int = Field(alias="failedCases")
    skipped_cases: int = Field(alias="skippedCases")
    overall_score: float = Field(alias="overallScore")
    passed: bool
    criteria: dict[str, EvalRunSummaryCriterion] = Field(default_factory=dict)


class EvalRunSnapshots(AgntzModel):
    eval: EvalDefinition
    dataset: EvalDataset
    agent: AgentDefinition | dict[str, Any]
    agent_version: str | None = Field(default=None, alias="agentVersion")
    requested_agent_version: str | None = Field(default=None, alias="requestedAgentVersion")


class EvalRun(AgntzModel):
    id: str
    eval_id: str = Field(alias="evalId")
    dataset_id: str = Field(alias="datasetId")
    agent_id: str = Field(alias="agentId")
    agent_version: str | None = Field(default=None, alias="agentVersion")
    requested_agent_version: str | None = Field(default=None, alias="requestedAgentVersion")
    status: str
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    snapshots: EvalRunSnapshots
    case_results: list[EvalCaseResult] = Field(default_factory=list, alias="caseResults")
    summary: EvalRunSummary | None = None
    error: str | None = None


class EvalRunListResult(AgntzModel):
    rows: list[EvalRun] = Field(default_factory=list)
    cursor: str | None = None


class EvalLatestScore(AgntzModel):
    eval_id: str = Field(alias="evalId")
    dataset_id: str = Field(alias="datasetId")
    agent_id: str = Field(alias="agentId")
    requested_agent_version: str | None = Field(default=None, alias="requestedAgentVersion")
    resolved_agent_version: str | None = Field(default=None, alias="resolvedAgentVersion")
    run_id: str = Field(alias="runId")
    status: str
    summary: EvalRunSummary | None = None
    overall_score: float = Field(alias="overallScore")
    passed: bool
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")
    updated_at: str = Field(alias="updatedAt")
