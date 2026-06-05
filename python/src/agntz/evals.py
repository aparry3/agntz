"""Eval scoring helpers and local eval execution."""

from __future__ import annotations

import asyncio
import base64
import json
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from agntz.agent_ref import format_agent_ref, parse_agent_ref
from agntz.client.models import (
    AgentDefinition,
    EvalCaseResult,
    EvalCriterion,
    EvalCriterionResult,
    EvalDataset,
    EvalDatasetItem,
    EvalDefinition,
    EvalLatestScore,
    EvalRun,
    EvalRunListResult,
    EvalRunSnapshots,
    EvalRunSummary,
    EvalRunSummaryCriterion,
)
from agntz.core.ids import nanoid

DEFAULT_PASS_THRESHOLD = 0.7


class EvalStoreLike(Protocol):
    def get_eval(self, eval_id: str) -> EvalDefinition | None: ...

    def get_dataset(self, dataset_id: str) -> EvalDataset | None: ...

    def put_eval_run(self, run: EvalRun) -> None: ...

    def get_eval_run(self, run_id: str) -> EvalRun | None: ...

    def put_eval_latest_score(self, score: EvalLatestScore) -> None: ...


@dataclass(frozen=True)
class TargetInvocation:
    output: Any
    usage: dict[str, int] | None = None
    invocation_id: str | None = None
    run_id: str | None = None


TargetInvoker = Callable[[str, Any], TargetInvocation | Awaitable[TargetInvocation]]
JudgeInvoker = Callable[[EvalDefinition, EvalDataset, EvalDatasetItem, Any], Any | Awaitable[Any]]


def normalize_pass_threshold(value: float | None) -> float:
    return _clamp_score(DEFAULT_PASS_THRESHOLD if value is None else value)


def normalize_criterion_weight(criterion: EvalCriterion) -> float:
    weight = criterion.weight if criterion.weight is not None else 1
    return weight if _is_finite(weight) and weight > 0 else 1


def score_judge_envelope(
    criteria: list[EvalCriterion],
    pass_threshold: float | None,
    envelope: Any,
) -> dict[str, Any]:
    source = envelope if isinstance(envelope, dict) else {}
    raw_criteria = source.get("criteria") if isinstance(source.get("criteria"), dict) else {}
    threshold = normalize_pass_threshold(pass_threshold)
    results: dict[str, EvalCriterionResult] = {}
    for criterion in criteria:
        raw = raw_criteria.get(criterion.id) if isinstance(raw_criteria, dict) else None
        row = raw if isinstance(raw, dict) else {}
        score = _clamp_score(_as_number(row.get("score"), 0))
        criterion_threshold = _clamp_score(
            criterion.threshold if criterion.threshold is not None else threshold
        )
        reason = row.get("reason")
        raw_passed = row.get("passed")
        results[criterion.id] = EvalCriterionResult(
            score=score,
            passed=raw_passed if isinstance(raw_passed, bool) else score >= criterion_threshold,
            reason=(
                reason
                if isinstance(reason, str) and reason.strip()
                else "No judge reason returned."
            ),
        )
    if criteria:
        overall = _weighted_average(criteria, lambda criterion: results[criterion.id].score)
    else:
        overall = _clamp_score(_as_number(source.get("overallScore"), 0))
    return {
        "overall_score": overall,
        "passed": overall >= threshold,
        "criteria": results,
        "reason": source.get("reason") if isinstance(source.get("reason"), str) else None,
    }


def summarize_eval_run(
    definition: EvalDefinition,
    case_results: list[EvalCaseResult],
) -> EvalRunSummary:
    completed = [row for row in case_results if row.status == "completed"]
    scored = [row for row in case_results if row.status in {"completed", "failed"}]
    failed = [row for row in case_results if row.status == "failed"]
    skipped = [row for row in case_results if row.status in {"skipped", "cancelled"}]
    overall = sum(row.score for row in scored) / len(scored) if scored else 0
    criteria_summary: dict[str, EvalRunSummaryCriterion] = {}
    for criterion in definition.criteria:
        rows = [
            row.criteria[criterion.id]
            for row in completed
            if criterion.id in row.criteria
        ]
        score = sum(row.score for row in rows) / len(rows) if rows else 0
        threshold = normalize_pass_threshold(
            criterion.threshold if criterion.threshold is not None else definition.pass_threshold
        )
        criteria_summary[criterion.id] = EvalRunSummaryCriterion(
            score=score,
            passed=bool(rows) and score >= threshold,
            completedCases=len(rows),
        )
    return EvalRunSummary(
        totalCases=len(case_results),
        completedCases=len(completed),
        failedCases=len(failed),
        skippedCases=len(skipped),
        overallScore=overall,
        passed=bool(case_results)
        and len(completed) == len(case_results)
        and overall >= normalize_pass_threshold(definition.pass_threshold),
        criteria=criteria_summary,
    )


def latest_score_from_eval_run(run: EvalRun) -> EvalLatestScore:
    summary = run.summary
    return EvalLatestScore(
        evalId=run.eval_id,
        datasetId=run.dataset_id,
        agentId=run.agent_id,
        requestedAgentVersion=run.requested_agent_version,
        resolvedAgentVersion=run.agent_version,
        runId=run.id,
        status=run.status,
        summary=summary,
        overallScore=summary.overall_score if summary else 0,
        passed=bool(summary and summary.passed),
        startedAt=run.started_at,
        endedAt=run.ended_at,
        updatedAt=_iso_now(),
    )


def list_eval_runs_in_process(
    rows: list[EvalRun],
    filters: dict[str, Any] | None = None,
) -> EvalRunListResult:
    filters = filters or {}
    limit = min(max(int(filters.get("limit") or 50), 1), 200)

    def include(run: EvalRun) -> bool:
        if filters.get("agent_id") and run.agent_id != filters["agent_id"]:
            return False
        if filters.get("agentId") and run.agent_id != filters["agentId"]:
            return False
        if filters.get("eval_id") and run.eval_id != filters["eval_id"]:
            return False
        if filters.get("evalId") and run.eval_id != filters["evalId"]:
            return False
        if filters.get("dataset_id") and run.dataset_id != filters["dataset_id"]:
            return False
        if filters.get("datasetId") and run.dataset_id != filters["datasetId"]:
            return False
        if filters.get("status") and run.status != filters["status"]:
            return False
        if filters.get("started_after") and run.started_at < filters["started_after"]:
            return False
        if filters.get("startedAfter") and run.started_at < filters["startedAfter"]:
            return False
        if filters.get("started_before") and run.started_at > filters["started_before"]:
            return False
        return not (filters.get("startedBefore") and run.started_at > filters["startedBefore"])

    ordered = sorted(
        [row for row in rows if include(row)],
        key=lambda row: (row.started_at, row.id),
        reverse=True,
    )
    start_idx = 0
    cursor = filters.get("cursor")
    if isinstance(cursor, str):
        decoded = _decode_cursor(cursor)
        if decoded:
            start_idx = next(
                (
                    idx
                    for idx, row in enumerate(ordered)
                    if row.started_at < decoded["startedAt"]
                    or (row.started_at == decoded["startedAt"] and row.id < decoded["id"])
                ),
                len(ordered),
            )
    page = ordered[start_idx : start_idx + limit]
    next_cursor = None
    if len(page) == limit and start_idx + limit < len(ordered):
        next_cursor = _encode_cursor({"startedAt": page[-1].started_at, "id": page[-1].id})
    return EvalRunListResult(rows=page, cursor=next_cursor)


def parse_judge_output_text(text: str) -> Any:
    trimmed = text.strip()
    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        marker = "```"
        start = trimmed.find(marker)
        if start == -1:
            raise ValueError("Judge did not return parseable JSON") from None
        body_start = trimmed.find("\n", start + len(marker))
        end = trimmed.find(marker, body_start + 1)
        if body_start == -1 or end == -1:
            raise ValueError("Judge did not return parseable JSON") from None
        return json.loads(trimmed[body_start:end].strip())


async def run_eval(
    store: EvalStoreLike,
    *,
    eval_id: str,
    dataset_id: str | None = None,
    agent_version: str | None = None,
    resolve_agent: Callable[[str], tuple[AgentDefinition, str | None]],
    invoke_target: TargetInvoker,
    invoke_judge: JudgeInvoker | None = None,
    cancel: Callable[[], bool] | None = None,
) -> EvalRun:
    definition = store.get_eval(eval_id)
    if definition is None:
        raise ValueError(f'Eval "{eval_id}" not found')
    if not definition.criteria:
        raise ValueError(f'Eval "{definition.id}" must define at least one criterion')
    resolved_dataset_id = dataset_id or definition.default_dataset_id
    if not resolved_dataset_id:
        raise ValueError(
            f'Eval "{definition.id}" does not specify a default dataset; pass dataset_id'
        )
    dataset = store.get_dataset(resolved_dataset_id)
    if dataset is None:
        raise ValueError(f'Dataset "{resolved_dataset_id}" not found')
    if dataset.agent_id != definition.agent_id:
        raise ValueError(
            f'Dataset "{dataset.id}" belongs to agent "{dataset.agent_id}", '
            f'not "{definition.agent_id}"'
        )
    agent_ref = (
        format_agent_ref(parse_agent_ref(f"{definition.agent_id}@{agent_version}"))
        if agent_version
        else definition.agent_id
    )
    agent, resolved_version = resolve_agent(agent_ref)
    run = EvalRun(
        id=f"evalrun_{nanoid()}",
        evalId=definition.id,
        datasetId=dataset.id,
        agentId=definition.agent_id,
        agentVersion=resolved_version,
        requestedAgentVersion=agent_version,
        status="running",
        startedAt=_iso_now(),
        snapshots=EvalRunSnapshots(
            eval=definition,
            dataset=dataset,
            agent=agent,
            agentVersion=resolved_version,
            requestedAgentVersion=agent_version,
        ),
        caseResults=[],
    )
    store.put_eval_run(run)
    try:
        for item in dataset.items:
            latest = store.get_eval_run(run.id)
            if (cancel and cancel()) or latest and latest.status == "cancelled":
                run.status = "cancelled"
                if latest and latest.status == "cancelled":
                    run.case_results = list(latest.case_results)
                if not any(row.item_id == item.id for row in run.case_results):
                    run.case_results.append(cancelled_eval_case(item))
                store.put_eval_run(run)
                continue
            result = await _run_case(
                definition=definition,
                dataset=dataset,
                item=item,
                agent_ref=agent_ref,
                invoke_target=invoke_target,
                invoke_judge=invoke_judge,
            )
            run.case_results.append(result)
            store.put_eval_run(run.model_copy(update={"case_results": list(run.case_results)}))
        run.summary = summarize_eval_run(definition, run.case_results)
        run.status = "cancelled" if cancel and cancel() else "completed"
        run.ended_at = _iso_now()
        store.put_eval_run(run)
        store.put_eval_latest_score(latest_score_from_eval_run(run))
        return run
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)
        run.summary = summarize_eval_run(definition, run.case_results)
        run.ended_at = _iso_now()
        store.put_eval_run(run)
        store.put_eval_latest_score(latest_score_from_eval_run(run))
        return run


async def _run_case(
    *,
    definition: EvalDefinition,
    dataset: EvalDataset,
    item: EvalDatasetItem,
    agent_ref: str,
    invoke_target: TargetInvoker,
    invoke_judge: JudgeInvoker | None,
) -> EvalCaseResult:
    started = time.time()
    try:
        target = await _maybe_await(invoke_target(agent_ref, item.input))
    except Exception as exc:
        return failed_eval_case(
            item,
            error=f"Target agent failed: {exc}",
            duration=_duration_ms(started),
        )
    try:
        if invoke_judge is None:
            envelope = _default_judge_envelope(definition)
        else:
            envelope = await _maybe_await(invoke_judge(definition, dataset, item, target.output))
        if isinstance(envelope, str):
            envelope = parse_judge_output_text(envelope)
        scored = score_judge_envelope(definition.criteria, definition.pass_threshold, envelope)
        return EvalCaseResult(
            itemId=item.id,
            status="completed",
            input=item.input,
            expected=item.expected,
            output=output_to_string(target.output),
            agentRunId=target.run_id,
            invocationId=target.invocation_id,
            usage=target.usage,
            duration=_duration_ms(started),
            criteria=scored["criteria"],
            score=scored["overall_score"],
            passed=scored["passed"],
            reason=scored.get("reason"),
        )
    except Exception as exc:
        return failed_eval_case(
            item,
            output=output_to_string(target.output),
            invocation_id=target.invocation_id,
            usage=target.usage,
            error=f"Judge failed: {exc}",
            duration=_duration_ms(started),
        )


def cancelled_eval_case(item: EvalDatasetItem) -> EvalCaseResult:
    return EvalCaseResult(
        itemId=item.id,
        status="cancelled",
        input=item.input,
        expected=item.expected,
        criteria={},
        score=0,
        passed=False,
        error="Eval run cancelled.",
    )


def failed_eval_case(
    item: EvalDatasetItem,
    *,
    error: str,
    duration: int,
    output: str | None = None,
    invocation_id: str | None = None,
    usage: dict[str, int] | None = None,
) -> EvalCaseResult:
    return EvalCaseResult(
        itemId=item.id,
        status="failed",
        input=item.input,
        expected=item.expected,
        output=output,
        invocationId=invocation_id,
        usage=usage,
        duration=duration,
        criteria={},
        score=0,
        passed=False,
        error=error,
    )


def output_to_string(value: Any) -> str:
    return (
        value
        if isinstance(value, str)
        else json.dumps(value, default=str, separators=(",", ":"))
    )


def _default_judge_envelope(definition: EvalDefinition) -> dict[str, Any]:
    criteria = {
        criterion.id: {"score": 1, "passed": True, "reason": "No judge configured."}
        for criterion in definition.criteria
    }
    return {"criteria": criteria, "reason": "No judge configured."}


async def _maybe_await(value: Any | Awaitable[Any]) -> Any:
    if asyncio.iscoroutine(value) or isinstance(value, Awaitable):
        return await value
    return value


def _weighted_average(
    criteria: list[EvalCriterion],
    read_score: Callable[[EvalCriterion], float],
) -> float:
    total = 0.0
    total_weight = 0.0
    for criterion in criteria:
        weight = normalize_criterion_weight(criterion)
        total += _clamp_score(read_score(criterion)) * weight
        total_weight += weight
    return total / total_weight if total_weight > 0 else 0


def _as_number(value: Any, fallback: float) -> float:
    return value if isinstance(value, int | float) and _is_finite(value) else fallback


def _is_finite(value: float) -> bool:
    return value == value and value not in {float("inf"), float("-inf")}


def _clamp_score(value: float) -> float:
    if not _is_finite(value):
        return 0
    return min(1, max(0, float(value)))


def _duration_ms(started_at: float) -> int:
    return int((time.time() - started_at) * 1000)


def _iso_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _encode_cursor(value: dict[str, str]) -> str:
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(value: str) -> dict[str, str] | None:
    try:
        padded = value + "=" * (-len(value) % 4)
        parsed = json.loads(base64.urlsafe_b64decode(padded).decode())
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    if not isinstance(parsed.get("startedAt"), str) or not isinstance(parsed.get("id"), str):
        return None
    return {"startedAt": parsed["startedAt"], "id": parsed["id"]}
