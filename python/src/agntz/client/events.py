"""Normalize worker SSE frames into Python client events."""

from __future__ import annotations

import json
from typing import Any

from ._sse import SseFrame
from .errors import StreamError
from .models import Event


def normalize_agent_event(frame: SseFrame) -> Event | None:
    if frame.event is None:
        return None
    payload = _parse_payload(frame)
    if frame.event == "run-start":
        return Event(
            type="start",
            agentId=_string(payload, "agentId"),
            kind=_agent_kind(payload),
            sessionId=_string(payload, "sessionId"),
        )
    if frame.event == "run-complete":
        state = payload.get("state")
        return Event(
            type="complete",
            output=payload.get("output"),
            state=state if isinstance(state, dict) else {},
            sessionId=_string(payload, "sessionId"),
        )
    if frame.event == "run-error":
        return Event(type="error", error=_string(payload, "error"))
    if frame.event == "reply":
        seq = payload.get("seq")
        return Event(
            type="reply",
            text=_string(payload, "text"),
            ts=_string(payload, "ts"),
            sessionId=_string(payload, "sessionId"),
            runId=_string(payload, "runId"),
            seq=seq if isinstance(seq, int) else None,
        )
    return None


def normalize_run_event(frame: SseFrame) -> Event | None:
    if frame.event is None:
        return None
    payload = _parse_payload(frame)
    if frame.event in {
        "run-spawn",
        "text-delta",
        "tool-call-start",
        "tool-call-end",
        "step-complete",
        "draining",
        "reply",
        "run-complete",
        "run-error",
        "run-cancelled",
    }:
        return Event.model_validate(payload)
    if frame.event == "snapshot":
        return Event.model_validate({"type": "snapshot", "run": payload})
    if frame.event == "stream-error":
        raise StreamError(_string(payload, "error"), code="STREAM_ERROR")
    return None


def normalize_trace_event(frame: SseFrame) -> Event | None:
    if frame.event is None:
        return None
    payload = _parse_payload(frame)
    if frame.event == "span-start":
        return Event.model_validate({"type": "span-start", "span": payload.get("span")})
    if frame.event == "span-end":
        return Event.model_validate(
            {
                "type": "span-end",
                "spanId": _string(payload, "spanId"),
                "patch": payload.get("patch") or {},
            }
        )
    if frame.event == "trace-done":
        return Event.model_validate({"type": "trace-done", "summary": payload.get("summary")})
    if frame.event == "snapshot":
        return Event.model_validate(
            {
                "type": "snapshot",
                "summary": payload.get("summary"),
                "spans": payload.get("spans") or [],
            }
        )
    if frame.event == "stream-error":
        raise StreamError(_string(payload, "error"), code="STREAM_ERROR")
    return None


def _parse_payload(frame: SseFrame) -> dict[str, Any]:
    try:
        value = json.loads(frame.data)
    except json.JSONDecodeError as exc:
        raise StreamError(
            f'Invalid JSON in "{frame.event}" event data',
            code="INVALID_SSE_PAYLOAD",
            cause=exc,
        ) from exc
    if not isinstance(value, dict):
        raise StreamError("SSE event data must be a JSON object", code="INVALID_SSE_PAYLOAD")
    return value


def _string(payload: dict[str, Any], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str):
        raise StreamError(
            f'SSE payload missing string field "{field}"',
            code="INVALID_SSE_PAYLOAD",
        )
    return value


def _agent_kind(payload: dict[str, Any]) -> str:
    value = payload.get("kind")
    if value in {"llm", "tool", "sequential", "parallel"}:
        return value
    raise StreamError(f"Unknown agent kind: {value}", code="INVALID_SSE_PAYLOAD")
