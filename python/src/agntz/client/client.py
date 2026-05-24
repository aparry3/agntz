"""Hosted Agntz client."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator, Mapping
from typing import Any
from urllib.parse import urlencode

import httpx

from ._sse import parse_sse, parse_sse_async
from .errors import AgntzError, AuthenticationError, NotFoundError, StreamError
from .events import normalize_agent_event, normalize_run_event, normalize_trace_event
from .models import (
    Event,
    HealthResult,
    Run,
    RunListResult,
    RunResult,
    TraceDetail,
    TracesListResult,
)


class AgntzClient:
    """Synchronous client for the hosted Agntz worker API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        http_client: httpx.Client | None = None,
        timeout: float | httpx.Timeout | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("AgntzClient: api_key is required")
        if not base_url:
            raise ValueError("AgntzClient: base_url is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = http_client or httpx.Client(timeout=timeout)
        self._owns_client = http_client is None
        self.agents = AgentsResource(self)
        self.runs = RunsResource(self)
        self.traces = TracesResource(self)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> AgntzClient:
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def health(self) -> HealthResult:
        response = self._request("GET", "/health", auth=False)
        return HealthResult.model_validate(response.json())

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, Any] | None = None,
        auth: bool = True,
        accept: str | None = None,
    ) -> httpx.Response:
        headers = _headers(self._api_key if auth else None, accept)
        response = self._client.request(
            method,
            _join_url(self._base_url, path),
            headers=headers,
            json=dict(json_body) if json_body is not None else None,
        )
        _raise_for_status(response)
        return response

    def _stream(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, Any] | None = None,
    ) -> httpx.Response:
        headers = _headers(self._api_key, "text/event-stream")
        stream = self._client.stream(
            method,
            _join_url(self._base_url, path),
            headers=headers,
            json=dict(json_body) if json_body is not None else None,
        )
        response = stream.__enter__()
        response.extensions["_agntz_stream_context"] = stream
        try:
            _raise_for_status(response)
        except BaseException:
            stream.__exit__(None, None, None)
            raise
        return response


class AsyncAgntzClient:
    """Async client for the hosted Agntz worker API."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        http_client: httpx.AsyncClient | None = None,
        timeout: float | httpx.Timeout | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("AsyncAgntzClient: api_key is required")
        if not base_url:
            raise ValueError("AsyncAgntzClient: base_url is required")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = http_client or httpx.AsyncClient(timeout=timeout)
        self._owns_client = http_client is None
        self.agents = AsyncAgentsResource(self)
        self.runs = AsyncRunsResource(self)
        self.traces = AsyncTracesResource(self)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> AsyncAgntzClient:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.aclose()

    async def health(self) -> HealthResult:
        response = await self._request("GET", "/health", auth=False)
        return HealthResult.model_validate(response.json())

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, Any] | None = None,
        auth: bool = True,
        accept: str | None = None,
    ) -> httpx.Response:
        response = await self._client.request(
            method,
            _join_url(self._base_url, path),
            headers=_headers(self._api_key if auth else None, accept),
            json=dict(json_body) if json_body is not None else None,
        )
        _raise_for_status(response)
        return response


class AgentsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def run(self, *, agent_id: str, input: Any = None, session_id: str | None = None) -> RunResult:
        response = self._client._request(
            "POST",
            "/run",
            json_body=_run_body(agent_id, input, session_id),
        )
        return RunResult.model_validate(response.json())

    def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
    ) -> Iterator[Event]:
        response = self._client._stream(
            "POST",
            "/run/stream",
            json_body=_run_body(agent_id, input, session_id),
        )
        context = response.extensions["_agntz_stream_context"]
        saw_terminal = False
        try:
            for frame in parse_sse(response.iter_text()):
                event = normalize_agent_event(frame)
                if event is None:
                    continue
                if event.type in {"complete", "error"}:
                    saw_terminal = True
                yield event
                if saw_terminal:
                    return
            if not saw_terminal:
                raise StreamError("Stream closed before completion", code="STREAM_TRUNCATED")
        finally:
            context.__exit__(None, None, None)


class AsyncAgentsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
    ) -> RunResult:
        response = await self._client._request(
            "POST",
            "/run",
            json_body=_run_body(agent_id, input, session_id),
        )
        return RunResult.model_validate(response.json())

    async def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
    ) -> AsyncIterator[Event]:
        async with self._client._client.stream(
            "POST",
            _join_url(self._client._base_url, "/run/stream"),
            headers=_headers(self._client._api_key, "text/event-stream"),
            json=_run_body(agent_id, input, session_id),
        ) as response:
            _raise_for_status(response)
            saw_terminal = False
            async for frame in parse_sse_async(response.aiter_text()):
                event = normalize_agent_event(frame)
                if event is None:
                    continue
                if event.type in {"complete", "error"}:
                    saw_terminal = True
                yield event
                if saw_terminal:
                    return
            if not saw_terminal:
                raise StreamError("Stream closed before completion", code="STREAM_TRUNCATED")


class RunsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def start(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        body = _run_body(agent_id, input, session_id)
        _add_if_defined(body, "callbackUrl", callback_url)
        _add_if_defined(body, "webhookSecretName", webhook_secret_name)
        response = self._client._request("POST", "/runs", json_body=body)
        return Run.model_validate(response.json())

    def get(self, run_id: str) -> Run:
        response = self._client._request("GET", f"/runs/{run_id}")
        return Run.model_validate(response.json())

    def cancel(self, run_id: str) -> Run:
        response = self._client._request("POST", f"/runs/{run_id}/cancel")
        return Run.model_validate(response.json())

    def list(
        self,
        *,
        roots_only: bool | None = None,
        agent_id: str | None = None,
        status: str | None = None,
        started_after: str | None = None,
        started_before: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> RunListResult:
        path = _with_query(
            "/runs",
            {
                "rootsOnly": roots_only,
                "agentId": agent_id,
                "status": status,
                "startedAfter": started_after,
                "startedBefore": started_before,
                "limit": limit,
                "cursor": cursor,
            },
        )
        response = self._client._request("GET", path)
        return RunListResult.model_validate(response.json())

    def stream(self, *, run_id: str, since: int | None = None) -> Iterator[Event]:
        path = f"/runs/{run_id}/stream" + (f"?since={since}" if since is not None else "")
        response = self._client._stream("GET", path)
        context = response.extensions["_agntz_stream_context"]
        try:
            for frame in parse_sse(response.iter_text()):
                event = normalize_run_event(frame)
                if event is None:
                    continue
                yield event
                event_run_id = getattr(event, "run_id", None) or getattr(event, "runId", None)
                if event.type == "snapshot" or (
                    event.type in {"run-complete", "run-error", "run-cancelled"}
                    and event_run_id == run_id
                ):
                    return
        finally:
            context.__exit__(None, None, None)


class AsyncRunsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def start(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        body = _run_body(agent_id, input, session_id)
        _add_if_defined(body, "callbackUrl", callback_url)
        _add_if_defined(body, "webhookSecretName", webhook_secret_name)
        response = await self._client._request("POST", "/runs", json_body=body)
        return Run.model_validate(response.json())

    async def get(self, run_id: str) -> Run:
        response = await self._client._request("GET", f"/runs/{run_id}")
        return Run.model_validate(response.json())

    async def cancel(self, run_id: str) -> Run:
        response = await self._client._request("POST", f"/runs/{run_id}/cancel")
        return Run.model_validate(response.json())

    async def list(
        self,
        *,
        roots_only: bool | None = None,
        agent_id: str | None = None,
        status: str | None = None,
        started_after: str | None = None,
        started_before: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> RunListResult:
        path = _with_query(
            "/runs",
            {
                "rootsOnly": roots_only,
                "agentId": agent_id,
                "status": status,
                "startedAfter": started_after,
                "startedBefore": started_before,
                "limit": limit,
                "cursor": cursor,
            },
        )
        response = await self._client._request("GET", path)
        return RunListResult.model_validate(response.json())

    async def stream(self, *, run_id: str, since: int | None = None) -> AsyncIterator[Event]:
        path = f"/runs/{run_id}/stream" + (f"?since={since}" if since is not None else "")
        async with self._client._client.stream(
            "GET",
            _join_url(self._client._base_url, path),
            headers=_headers(self._client._api_key, "text/event-stream"),
        ) as response:
            _raise_for_status(response)
            async for frame in parse_sse_async(response.aiter_text()):
                event = normalize_run_event(frame)
                if event is None:
                    continue
                yield event
                event_run_id = getattr(event, "run_id", None) or getattr(event, "runId", None)
                if event.type == "snapshot" or (
                    event.type in {"run-complete", "run-error", "run-cancelled"}
                    and event_run_id == run_id
                ):
                    return


class TracesResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def list(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        started_after: str | None = None,
        started_before: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> TracesListResult:
        path = _with_query(
            "/traces",
            {
                "agentId": agent_id,
                "status": status,
                "startedAfter": started_after,
                "startedBefore": started_before,
                "limit": limit,
                "cursor": cursor,
            },
        )
        response = self._client._request("GET", path)
        return TracesListResult.model_validate(response.json())

    def get(self, trace_id: str) -> TraceDetail:
        response = self._client._request("GET", f"/traces/{trace_id}")
        return TraceDetail.model_validate(response.json())

    def delete(self, trace_id: str) -> None:
        self._client._request("DELETE", f"/traces/{trace_id}")

    def stream(self, trace_id: str) -> Iterator[Event]:
        response = self._client._stream("GET", f"/traces/{trace_id}/stream")
        context = response.extensions["_agntz_stream_context"]
        try:
            for frame in parse_sse(response.iter_text()):
                event = normalize_trace_event(frame)
                if event is None:
                    continue
                yield event
                if event.type in {"snapshot", "trace-done"}:
                    return
        finally:
            context.__exit__(None, None, None)


class AsyncTracesResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def list(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
        started_after: str | None = None,
        started_before: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> TracesListResult:
        path = _with_query(
            "/traces",
            {
                "agentId": agent_id,
                "status": status,
                "startedAfter": started_after,
                "startedBefore": started_before,
                "limit": limit,
                "cursor": cursor,
            },
        )
        response = await self._client._request("GET", path)
        return TracesListResult.model_validate(response.json())

    async def get(self, trace_id: str) -> TraceDetail:
        response = await self._client._request("GET", f"/traces/{trace_id}")
        return TraceDetail.model_validate(response.json())

    async def delete(self, trace_id: str) -> None:
        await self._client._request("DELETE", f"/traces/{trace_id}")

    async def stream(self, trace_id: str) -> AsyncIterator[Event]:
        async with self._client._client.stream(
            "GET",
            _join_url(self._client._base_url, f"/traces/{trace_id}/stream"),
            headers=_headers(self._client._api_key, "text/event-stream"),
        ) as response:
            _raise_for_status(response)
            async for frame in parse_sse_async(response.aiter_text()):
                event = normalize_trace_event(frame)
                if event is None:
                    continue
                yield event
                if event.type in {"snapshot", "trace-done"}:
                    return


def _run_body(agent_id: str, input: Any, session_id: str | None) -> dict[str, Any]:
    body: dict[str, Any] = {"agentId": agent_id}
    _add_if_defined(body, "input", input)
    _add_if_defined(body, "sessionId", session_id)
    return body


def _add_if_defined(body: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        body[key] = value


def _headers(api_key: str | None, accept: str | None) -> dict[str, str]:
    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if accept:
        headers["Accept"] = accept
    return headers


def _join_url(base_url: str, path: str) -> str:
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{base_url.rstrip('/')}{suffix}"


def _with_query(path: str, params: Mapping[str, Any]) -> str:
    clean = {
        key: str(value).lower() if isinstance(value, bool) else value
        for key, value in params.items()
        if value is not None
    }
    if not clean:
        return path
    return f"{path}?{urlencode(clean)}"


def _raise_for_status(response: httpx.Response) -> None:
    if 200 <= response.status_code < 300:
        return
    message = _read_error_message(response)
    if response.status_code == 401:
        raise AuthenticationError(message, status=response.status_code)
    if response.status_code == 404:
        raise NotFoundError(message, status=response.status_code)
    raise AgntzError(message, status=response.status_code)


def _read_error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    if isinstance(body, dict) and isinstance(body.get("error"), str):
        return body["error"]
    return f"HTTP {response.status_code}"
