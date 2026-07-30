"""Hosted Agntz client."""

from __future__ import annotations

import asyncio
import concurrent.futures
import csv
import inspect
import io
import json
import mimetypes
import threading
import time
from collections.abc import AsyncIterator, Awaitable, Iterator, Mapping, Sequence
from contextlib import suppress
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from ._sse import parse_sse, parse_sse_async
from .client_tools import ClientToolContext, ClientToolHandler, ClientToolHandlers
from .errors import AgntzError, AuthenticationError, NotFoundError, StreamError
from .events import normalize_agent_event, normalize_run_event, normalize_trace_event
from .models import (
    AgentDefinition,
    AgentVersionSummary,
    ArtifactRef,
    BatchDefinition,
    BatchRun,
    BatchRunComparisonResult,
    BatchRunItemsPage,
    BatchRunListResult,
    BatchSummary,
    BatchVersionSummary,
    DatasetImportResult,
    DatasetItemsPage,
    EvalDataset,
    EvalDefinition,
    EvalLatestScore,
    EvalRun,
    EvalRunListResult,
    Event,
    HealthResult,
    MemoryCurateResult,
    MemoryDeleteEntryResult,
    MemoryEntriesPage,
    MemoryEntry,
    MemoryScanResult,
    RetentionRequest,
    Run,
    RunListResult,
    RunResult,
    ScopeDeleteResult,
    TraceDetail,
    TracesListResult,
)

CLIENT_TOOL_RESULT_MAX_CHARS = 40_000


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
        self.artifacts = ArtifactsResource(self)
        self.batches = BatchesResource(self)
        self.datasets = DatasetsResource(self)
        self.evals = EvalsResource(self)
        self.runs = RunsResource(self)
        self.sessions = SessionsResource(self)
        self.traces = TracesResource(self)
        self.memory = MemoryResource(self)

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
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = _headers(self._api_key if auth else None, accept)
        request_headers.update(headers or {})
        response = self._client.request(
            method,
            _join_url(self._base_url, path),
            headers=request_headers,
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

    def _prepare_run_body(
        self,
        agent_id: str,
        input: Any,
        content: Sequence[Mapping[str, Any]] | None,
        session_id: str | None,
        context: list[str] | None,
        retention: RetentionRequest | Mapping[str, Any] | None,
        client_tools: ClientToolHandlers | None = None,
    ) -> dict[str, Any]:
        legacy_content = content is None and _is_content_blocks(input)
        body: dict[str, Any] = {"agentId": agent_id}
        if input is not None and not legacy_content:
            body["input"] = input
        selected_content = input if legacy_content else content
        if selected_content is not None:
            artifact_ttl = _retention_artifact_ttl(retention)
            body["content"] = self.artifacts._prepare_content(
                selected_content, expires_in_seconds=artifact_ttl
            )
        _add_if_defined(body, "sessionId", session_id)
        _add_if_defined(body, "context", context)
        if retention is not None:
            body["retention"] = _retention_body(retention)
        if client_tools is not None:
            body["clientTools"] = list(client_tools)
        return body


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
        self.artifacts = AsyncArtifactsResource(self)
        self.batches = AsyncBatchesResource(self)
        self.datasets = AsyncDatasetsResource(self)
        self.evals = AsyncEvalsResource(self)
        self.runs = AsyncRunsResource(self)
        self.sessions = AsyncSessionsResource(self)
        self.traces = AsyncTracesResource(self)
        self.memory = AsyncMemoryResource(self)

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
        headers: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        request_headers = _headers(self._api_key if auth else None, accept)
        request_headers.update(headers or {})
        response = await self._client.request(
            method,
            _join_url(self._base_url, path),
            headers=request_headers,
            json=dict(json_body) if json_body is not None else None,
        )
        _raise_for_status(response)
        return response

    async def _prepare_run_body(
        self,
        agent_id: str,
        input: Any,
        content: Sequence[Mapping[str, Any]] | None,
        session_id: str | None,
        context: list[str] | None,
        retention: RetentionRequest | Mapping[str, Any] | None,
        client_tools: ClientToolHandlers | None = None,
    ) -> dict[str, Any]:
        legacy_content = content is None and _is_content_blocks(input)
        body: dict[str, Any] = {"agentId": agent_id}
        if input is not None and not legacy_content:
            body["input"] = input
        selected_content = input if legacy_content else content
        if selected_content is not None:
            artifact_ttl = _retention_artifact_ttl(retention)
            body["content"] = await self.artifacts._prepare_content(
                selected_content, expires_in_seconds=artifact_ttl
            )
        _add_if_defined(body, "sessionId", session_id)
        _add_if_defined(body, "context", context)
        if retention is not None:
            body["retention"] = _retention_body(retention)
        if client_tools is not None:
            body["clientTools"] = list(client_tools)
        return body


class AgentsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        client_tools: ClientToolHandlers | None = None,
    ) -> RunResult:
        body = self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention, client_tools
        )
        if client_tools is not None:
            return _run_attached_sync(self._client, body, client_tools)
        response = self._client._request(
            "POST",
            "/run",
            json_body=body,
        )
        return RunResult.model_validate(response.json())

    def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        client_tools: ClientToolHandlers | None = None,
    ) -> Iterator[Event]:
        body = self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention, client_tools
        )
        response = self._client._stream(
            "POST",
            "/run/stream",
            json_body=body,
        )
        stream_context = response.extensions["_agntz_stream_context"]
        saw_terminal = False
        try:
            for frame in parse_sse(response.iter_text()):
                if frame.event == "client-tool-request":
                    _handle_client_tool_sync(self._client, frame.data, client_tools or {})
                    continue
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
            stream_context.__exit__(None, None, None)

    def start(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        return self._client.runs.start(
            agent_id=agent_id,
            input=input,
            content=content,
            session_id=session_id,
            context=context,
            retention=retention,
            callback_url=callback_url,
            webhook_secret_name=webhook_secret_name,
        )

    def list(self) -> list[dict[str, Any]]:
        response = self._client._request("GET", "/agents")
        return list(response.json())

    def import_(
        self,
        *,
        agents: Sequence[Mapping[str, Any]],
        on_conflict: str | None = None,
        dry_run: bool | None = None,
        strict: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"agents": [dict(agent) for agent in agents]}
        _add_if_defined(body, "onConflict", on_conflict)
        _add_if_defined(body, "dryRun", dry_run)
        _add_if_defined(body, "strict", strict)
        response = self._client._request("POST", "/agents/import", json_body=body)
        return dict(response.json())

    def get(self, agent_id: str) -> AgentDefinition:
        response = self._client._request("GET", f"/agents/{_q(agent_id)}")
        return AgentDefinition.model_validate(response.json())

    def create(
        self,
        agent: AgentDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> AgentDefinition:
        response = self._client._request(
            "POST",
            "/agents",
            json_body=_model_body(agent, kwargs),
        )
        return AgentDefinition.model_validate(response.json())

    def update(
        self,
        agent_id: str,
        patch: AgentDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> AgentDefinition:
        response = self._client._request(
            "PUT",
            f"/agents/{_q(agent_id)}",
            json_body=_model_body(patch, kwargs),
        )
        return AgentDefinition.model_validate(response.json())

    def delete(self, agent_id: str) -> None:
        self._client._request("DELETE", f"/agents/{_q(agent_id)}")

    def list_versions(self, agent_id: str) -> list[AgentVersionSummary]:
        response = self._client._request("GET", f"/agents/{_q(agent_id)}/versions")
        return [AgentVersionSummary.model_validate(row) for row in response.json()]

    def get_version(self, agent_id: str, created_at: str) -> AgentDefinition:
        response = self._client._request(
            "GET",
            f"/agents/{_q(agent_id)}/versions/{_q(created_at)}",
        )
        return AgentDefinition.model_validate(response.json())

    def activate_version(self, agent_id: str, created_at: str) -> None:
        self._client._request("POST", f"/agents/{_q(agent_id)}/versions/{_q(created_at)}/activate")

    def set_alias(self, agent_id: str, alias: str, created_at: str) -> dict[str, Any]:
        response = self._client._request(
            "PUT",
            f"/agents/{_q(agent_id)}/aliases/{_q(alias)}",
            json_body={"createdAt": created_at},
        )
        return dict(response.json())

    def remove_alias(self, agent_id: str, alias: str) -> dict[str, Any]:
        response = self._client._request("DELETE", f"/agents/{_q(agent_id)}/aliases/{_q(alias)}")
        return dict(response.json())


class AsyncAgentsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        client_tools: ClientToolHandlers | None = None,
    ) -> RunResult:
        body = await self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention, client_tools
        )
        if client_tools is not None:
            return await _run_attached_async(self._client, body, client_tools)
        response = await self._client._request(
            "POST",
            "/run",
            json_body=body,
        )
        return RunResult.model_validate(response.json())

    async def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        client_tools: ClientToolHandlers | None = None,
    ) -> AsyncIterator[Event]:
        body = await self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention, client_tools
        )
        async with self._client._client.stream(
            "POST",
            _join_url(self._client._base_url, "/run/stream"),
            headers=_headers(self._client._api_key, "text/event-stream"),
            json=body,
        ) as response:
            _raise_for_status(response)
            saw_terminal = False
            async for frame in parse_sse_async(response.aiter_text()):
                if frame.event == "client-tool-request":
                    await _handle_client_tool_async(self._client, frame.data, client_tools or {})
                    continue
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

    async def start(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        return await self._client.runs.start(
            agent_id=agent_id,
            input=input,
            content=content,
            session_id=session_id,
            context=context,
            retention=retention,
            callback_url=callback_url,
            webhook_secret_name=webhook_secret_name,
        )

    async def list(self) -> list[dict[str, Any]]:
        response = await self._client._request("GET", "/agents")
        return list(response.json())

    async def import_(
        self,
        *,
        agents: Sequence[Mapping[str, Any]],
        on_conflict: str | None = None,
        dry_run: bool | None = None,
        strict: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"agents": [dict(agent) for agent in agents]}
        _add_if_defined(body, "onConflict", on_conflict)
        _add_if_defined(body, "dryRun", dry_run)
        _add_if_defined(body, "strict", strict)
        response = await self._client._request("POST", "/agents/import", json_body=body)
        return dict(response.json())

    async def get(self, agent_id: str) -> AgentDefinition:
        response = await self._client._request("GET", f"/agents/{_q(agent_id)}")
        return AgentDefinition.model_validate(response.json())

    async def create(
        self,
        agent: AgentDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> AgentDefinition:
        response = await self._client._request(
            "POST",
            "/agents",
            json_body=_model_body(agent, kwargs),
        )
        return AgentDefinition.model_validate(response.json())

    async def update(
        self,
        agent_id: str,
        patch: AgentDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> AgentDefinition:
        response = await self._client._request(
            "PUT",
            f"/agents/{_q(agent_id)}",
            json_body=_model_body(patch, kwargs),
        )
        return AgentDefinition.model_validate(response.json())

    async def delete(self, agent_id: str) -> None:
        await self._client._request("DELETE", f"/agents/{_q(agent_id)}")

    async def list_versions(self, agent_id: str) -> list[AgentVersionSummary]:
        response = await self._client._request("GET", f"/agents/{_q(agent_id)}/versions")
        return [AgentVersionSummary.model_validate(row) for row in response.json()]

    async def get_version(self, agent_id: str, created_at: str) -> AgentDefinition:
        response = await self._client._request(
            "GET",
            f"/agents/{_q(agent_id)}/versions/{_q(created_at)}",
        )
        return AgentDefinition.model_validate(response.json())

    async def activate_version(self, agent_id: str, created_at: str) -> None:
        await self._client._request(
            "POST",
            f"/agents/{_q(agent_id)}/versions/{_q(created_at)}/activate",
        )

    async def set_alias(self, agent_id: str, alias: str, created_at: str) -> dict[str, Any]:
        response = await self._client._request(
            "PUT",
            f"/agents/{_q(agent_id)}/aliases/{_q(alias)}",
            json_body={"createdAt": created_at},
        )
        return dict(response.json())

    async def remove_alias(self, agent_id: str, alias: str) -> dict[str, Any]:
        response = await self._client._request(
            "DELETE",
            f"/agents/{_q(agent_id)}/aliases/{_q(alias)}",
        )
        return dict(response.json())


class ArtifactsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def upload(
        self,
        *,
        file: Any,
        purpose: str = "input",
        expires_in_seconds: int | None = None,
        media_type: str | None = None,
        filename: str | None = None,
    ) -> ArtifactRef:
        payload, resolved_filename, resolved_media_type = _artifact_payload(
            file, media_type=media_type, filename=filename
        )
        data = {"purpose": purpose}
        if expires_in_seconds is not None:
            data["expiresInSeconds"] = str(expires_in_seconds)
        response = self._client._client.request(
            "POST",
            _join_url(self._client._base_url, "/artifacts"),
            headers=_headers(self._client._api_key, None),
            data=data,
            files={"file": (resolved_filename, payload, resolved_media_type)},
        )
        _raise_for_status(response)
        return ArtifactRef.model_validate(response.json())

    def get(self, artifact_id: str) -> ArtifactRef:
        response = self._client._request("GET", f"/artifacts/{_q(artifact_id)}")
        return ArtifactRef.model_validate(response.json())

    def download(self, artifact_id: str) -> bytes:
        response = self._client._request("GET", f"/artifacts/{_q(artifact_id)}/content")
        return response.content

    def delete(self, artifact_id: str) -> None:
        self._client._request("DELETE", f"/artifacts/{_q(artifact_id)}")

    def _prepare_content(
        self,
        content: Sequence[Mapping[str, Any]],
        *,
        expires_in_seconds: int | None,
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        for block in content:
            wire = {_snake_to_camel(str(key)): value for key, value in block.items()}
            if "file" in wire:
                local_file = wire.pop("file")
                artifact = self.upload(
                    file=local_file,
                    purpose="input",
                    expires_in_seconds=expires_in_seconds,
                    media_type=wire.get("mediaType"),
                )
                wire["artifactId"] = artifact.id
            prepared.append(wire)
        return prepared


class AsyncArtifactsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def upload(
        self,
        *,
        file: Any,
        purpose: str = "input",
        expires_in_seconds: int | None = None,
        media_type: str | None = None,
        filename: str | None = None,
    ) -> ArtifactRef:
        payload, resolved_filename, resolved_media_type = await asyncio.to_thread(
            _artifact_payload, file, media_type=media_type, filename=filename
        )
        data = {"purpose": purpose}
        if expires_in_seconds is not None:
            data["expiresInSeconds"] = str(expires_in_seconds)
        response = await self._client._client.request(
            "POST",
            _join_url(self._client._base_url, "/artifacts"),
            headers=_headers(self._client._api_key, None),
            data=data,
            files={"file": (resolved_filename, payload, resolved_media_type)},
        )
        _raise_for_status(response)
        return ArtifactRef.model_validate(response.json())

    async def get(self, artifact_id: str) -> ArtifactRef:
        response = await self._client._request("GET", f"/artifacts/{_q(artifact_id)}")
        return ArtifactRef.model_validate(response.json())

    async def download(self, artifact_id: str) -> bytes:
        response = await self._client._request("GET", f"/artifacts/{_q(artifact_id)}/content")
        return response.content

    async def delete(self, artifact_id: str) -> None:
        await self._client._request("DELETE", f"/artifacts/{_q(artifact_id)}")

    async def _prepare_content(
        self,
        content: Sequence[Mapping[str, Any]],
        *,
        expires_in_seconds: int | None,
    ) -> list[dict[str, Any]]:
        prepared: list[dict[str, Any]] = []
        for block in content:
            wire = {_snake_to_camel(str(key)): value for key, value in block.items()}
            if "file" in wire:
                local_file = wire.pop("file")
                artifact = await self.upload(
                    file=local_file,
                    purpose="input",
                    expires_in_seconds=expires_in_seconds,
                    media_type=wire.get("mediaType"),
                )
                wire["artifactId"] = artifact.id
            prepared.append(wire)
        return prepared


class SessionsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def import_(
        self,
        *,
        sessions: Sequence[Mapping[str, Any]],
        on_conflict: str | None = None,
        dry_run: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"sessions": [dict(session) for session in sessions]}
        _add_if_defined(body, "onConflict", on_conflict)
        _add_if_defined(body, "dryRun", dry_run)
        response = self._client._request("POST", "/sessions/import", json_body=body)
        return dict(response.json())

    def list(self, *, agent_id: str | None = None) -> list[dict[str, Any]]:
        response = self._client._request("GET", _with_query("/sessions", {"agentId": agent_id}))
        body = response.json()
        return list(body.get("sessions", [])) if isinstance(body, dict) else list(body)

    def get(self, session_id: str) -> dict[str, Any]:
        response = self._client._request("GET", f"/sessions/{_q(session_id)}")
        return dict(response.json())

    def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        return list(self.get(session_id).get("messages", []))

    def delete(self, session_id: str) -> None:
        self._client._request("DELETE", f"/sessions/{_q(session_id)}")


class AsyncSessionsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def import_(
        self,
        *,
        sessions: Sequence[Mapping[str, Any]],
        on_conflict: str | None = None,
        dry_run: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"sessions": [dict(session) for session in sessions]}
        _add_if_defined(body, "onConflict", on_conflict)
        _add_if_defined(body, "dryRun", dry_run)
        response = await self._client._request("POST", "/sessions/import", json_body=body)
        return dict(response.json())

    async def list(self, *, agent_id: str | None = None) -> list[dict[str, Any]]:
        response = await self._client._request(
            "GET",
            _with_query("/sessions", {"agentId": agent_id}),
        )
        body = response.json()
        return list(body.get("sessions", [])) if isinstance(body, dict) else list(body)

    async def get(self, session_id: str) -> dict[str, Any]:
        response = await self._client._request("GET", f"/sessions/{_q(session_id)}")
        return dict(response.json())

    async def get_messages(self, session_id: str) -> list[dict[str, Any]]:
        return list((await self.get(session_id)).get("messages", []))

    async def delete(self, session_id: str) -> None:
        await self._client._request("DELETE", f"/sessions/{_q(session_id)}")


class DatasetsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def list(self, *, agent_id: str | None = None) -> list[EvalDataset]:
        response = self._client._request("GET", _with_query("/datasets", {"agentId": agent_id}))
        return [EvalDataset.model_validate(row) for row in response.json()]

    def create(
        self,
        dataset: EvalDataset | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDataset:
        response = self._client._request(
            "POST",
            "/datasets",
            json_body=_model_body(dataset, kwargs),
        )
        return EvalDataset.model_validate(response.json())

    def get(self, dataset_id: str) -> EvalDataset:
        response = self._client._request("GET", f"/datasets/{_q(dataset_id)}")
        return EvalDataset.model_validate(response.json())

    def update(
        self,
        dataset_id: str,
        patch: EvalDataset | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDataset:
        response = self._client._request(
            "PUT",
            f"/datasets/{_q(dataset_id)}",
            json_body=_model_body(patch, kwargs),
        )
        return EvalDataset.model_validate(response.json())

    def delete(self, dataset_id: str) -> None:
        self._client._request("DELETE", f"/datasets/{_q(dataset_id)}")

    def items(
        self,
        dataset_id: str,
        *,
        version: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> DatasetItemsPage:
        response = self._client._request(
            "GET",
            _with_query(
                f"/datasets/{_q(dataset_id)}/items",
                {"version": version, "limit": limit, "cursor": cursor},
            ),
        )
        return DatasetItemsPage.model_validate(response.json())

    def import_(
        self,
        source: str | Path | Sequence[Mapping[str, Any]],
        *,
        format: str | None = None,
        dataset_id: str | None = None,
        name: str | None = None,
        description: str | None = None,
        agent_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        id_column: str = "id",
        input_column: str = "input",
    ) -> EvalDataset:
        staged_response = self._client._request(
            "POST",
            "/dataset-imports",
            json_body=_without_none(
                {
                    "datasetId": dataset_id,
                    "name": name,
                    "description": description,
                    "agentId": agent_id,
                    "metadata": dict(metadata) if metadata is not None else None,
                }
            ),
        )
        staged = DatasetImportResult.model_validate(staged_response.json())
        try:
            items = _parse_dataset_source(source, format, id_column, input_column)
            for offset in range(0, len(items), 1_000):
                self._client._request(
                    "POST",
                    f"/dataset-imports/{_q(staged.id)}/items",
                    json_body={"items": items[offset : offset + 1_000]},
                )
            response = self._client._request("POST", f"/dataset-imports/{_q(staged.id)}/complete")
            return EvalDataset.model_validate(response.json())
        except BaseException:
            with suppress(BaseException):
                self._client._request("DELETE", f"/dataset-imports/{_q(staged.id)}")
            raise


class AsyncDatasetsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def list(self, *, agent_id: str | None = None) -> list[EvalDataset]:
        response = await self._client._request(
            "GET",
            _with_query("/datasets", {"agentId": agent_id}),
        )
        return [EvalDataset.model_validate(row) for row in response.json()]

    async def create(
        self,
        dataset: EvalDataset | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDataset:
        response = await self._client._request(
            "POST",
            "/datasets",
            json_body=_model_body(dataset, kwargs),
        )
        return EvalDataset.model_validate(response.json())

    async def get(self, dataset_id: str) -> EvalDataset:
        response = await self._client._request("GET", f"/datasets/{_q(dataset_id)}")
        return EvalDataset.model_validate(response.json())

    async def update(
        self,
        dataset_id: str,
        patch: EvalDataset | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDataset:
        response = await self._client._request(
            "PUT",
            f"/datasets/{_q(dataset_id)}",
            json_body=_model_body(patch, kwargs),
        )
        return EvalDataset.model_validate(response.json())

    async def delete(self, dataset_id: str) -> None:
        await self._client._request("DELETE", f"/datasets/{_q(dataset_id)}")

    async def items(
        self,
        dataset_id: str,
        *,
        version: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> DatasetItemsPage:
        response = await self._client._request(
            "GET",
            _with_query(
                f"/datasets/{_q(dataset_id)}/items",
                {"version": version, "limit": limit, "cursor": cursor},
            ),
        )
        return DatasetItemsPage.model_validate(response.json())

    async def import_(
        self,
        source: str | Path | Sequence[Mapping[str, Any]],
        *,
        format: str | None = None,
        dataset_id: str | None = None,
        name: str | None = None,
        description: str | None = None,
        agent_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
        id_column: str = "id",
        input_column: str = "input",
    ) -> EvalDataset:
        staged_response = await self._client._request(
            "POST",
            "/dataset-imports",
            json_body=_without_none(
                {
                    "datasetId": dataset_id,
                    "name": name,
                    "description": description,
                    "agentId": agent_id,
                    "metadata": dict(metadata) if metadata is not None else None,
                }
            ),
        )
        staged = DatasetImportResult.model_validate(staged_response.json())
        try:
            items = _parse_dataset_source(source, format, id_column, input_column)
            for offset in range(0, len(items), 1_000):
                await self._client._request(
                    "POST",
                    f"/dataset-imports/{_q(staged.id)}/items",
                    json_body={"items": items[offset : offset + 1_000]},
                )
            response = await self._client._request(
                "POST", f"/dataset-imports/{_q(staged.id)}/complete"
            )
            return EvalDataset.model_validate(response.json())
        except BaseException:
            with suppress(BaseException):
                await self._client._request("DELETE", f"/dataset-imports/{_q(staged.id)}")
            raise


class BatchesResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def list(self) -> list[BatchSummary]:
        response = self._client._request("GET", "/batches")
        return [BatchSummary.model_validate(row) for row in response.json()]

    def create(self, manifest: str) -> BatchDefinition:
        response = self._client._request("POST", "/batches", json_body={"manifest": manifest})
        return BatchDefinition.model_validate(response.json())

    def get(self, batch_id: str) -> BatchDefinition:
        response = self._client._request("GET", f"/batches/{_q(batch_id)}")
        return BatchDefinition.model_validate(response.json())

    def update(self, batch_id: str, manifest: str) -> BatchDefinition:
        response = self._client._request(
            "PUT", f"/batches/{_q(batch_id)}", json_body={"manifest": manifest}
        )
        return BatchDefinition.model_validate(response.json())

    def delete(self, batch_id: str) -> None:
        self._client._request("DELETE", f"/batches/{_q(batch_id)}")

    def versions(self, batch_id: str) -> list[BatchVersionSummary]:
        response = self._client._request("GET", f"/batches/{_q(batch_id)}/versions")
        return [BatchVersionSummary.model_validate(row) for row in response.json()]

    def get_version(self, batch_id: str, version: str) -> BatchDefinition:
        response = self._client._request("GET", f"/batches/{_q(batch_id)}/versions/{_q(version)}")
        return BatchDefinition.model_validate(response.json())

    def activate_version(self, batch_id: str, version: str) -> BatchDefinition:
        response = self._client._request(
            "POST", f"/batches/{_q(batch_id)}/versions/{_q(version)}/activate"
        )
        return BatchDefinition.model_validate(response.json())

    def set_alias(self, batch_id: str, alias: str, version: str) -> dict[str, Any]:
        response = self._client._request(
            "PUT",
            f"/batches/{_q(batch_id)}/aliases/{_q(alias)}",
            json_body={"version": version},
        )
        return dict(response.json())

    def remove_alias(self, batch_id: str, alias: str) -> None:
        self._client._request("DELETE", f"/batches/{_q(batch_id)}/aliases/{_q(alias)}")

    def run(
        self,
        *,
        batch_id: str,
        batch_version: str | None = None,
        dataset_id: str | None = None,
        dataset_version: str | None = None,
        items: Sequence[Mapping[str, Any]] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
        idempotency_key: str | None = None,
    ) -> BatchRun:
        body = _without_none(
            {
                "batchId": batch_id,
                "batchVersion": batch_version,
                "datasetId": dataset_id,
                "datasetVersion": dataset_version,
                "items": [dict(item) for item in items] if items is not None else None,
                "callbackUrl": callback_url,
                "webhookSecretName": webhook_secret_name,
            }
        )
        response = self._client._request(
            "POST",
            "/batch-runs",
            json_body=body,
            headers={"Idempotency-Key": idempotency_key} if idempotency_key else None,
        )
        return BatchRun.model_validate(response.json())

    def get_run(self, run_id: str) -> BatchRun:
        response = self._client._request("GET", f"/batch-runs/{_q(run_id)}")
        return BatchRun.model_validate(response.json())

    def list_runs(self, **filters: Any) -> BatchRunListResult:
        response = self._client._request(
            "GET",
            _with_query(
                "/batch-runs",
                {
                    "batchId": filters.get("batch_id"),
                    "batchVersion": filters.get("batch_version"),
                    "datasetId": filters.get("dataset_id"),
                    "datasetVersion": filters.get("dataset_version"),
                    "provider": filters.get("provider"),
                    "model": filters.get("model"),
                    "status": filters.get("status"),
                    "startedAfter": filters.get("started_after"),
                    "startedBefore": filters.get("started_before"),
                    "limit": filters.get("limit"),
                    "cursor": filters.get("cursor"),
                },
            ),
        )
        return BatchRunListResult.model_validate(response.json())

    def cancel(self, run_id: str) -> BatchRun:
        response = self._client._request("POST", f"/batch-runs/{_q(run_id)}/cancel")
        return BatchRun.model_validate(response.json())

    def delete_run(self, run_id: str) -> None:
        self._client._request("DELETE", f"/batch-runs/{_q(run_id)}")

    def items(
        self,
        run_id: str,
        *,
        status: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> BatchRunItemsPage:
        response = self._client._request(
            "GET",
            _with_query(
                f"/batch-runs/{_q(run_id)}/items",
                {"status": status, "limit": limit, "cursor": cursor},
            ),
        )
        return BatchRunItemsPage.model_validate(response.json())

    def results_jsonl(self, run_id: str) -> str:
        response = self._client._request(
            "GET",
            f"/batch-runs/{_q(run_id)}/results.jsonl",
            accept="application/x-ndjson",
        )
        return response.text

    def compare(
        self,
        left: str,
        right: str,
        *,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> BatchRunComparisonResult:
        response = self._client._request(
            "GET",
            _with_query(
                "/batch-runs/compare",
                {"left": left, "right": right, "limit": limit, "cursor": cursor},
            ),
        )
        return BatchRunComparisonResult.model_validate(response.json())


class AsyncBatchesResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def list(self) -> list[BatchSummary]:
        response = await self._client._request("GET", "/batches")
        return [BatchSummary.model_validate(row) for row in response.json()]

    async def create(self, manifest: str) -> BatchDefinition:
        response = await self._client._request("POST", "/batches", json_body={"manifest": manifest})
        return BatchDefinition.model_validate(response.json())

    async def get(self, batch_id: str) -> BatchDefinition:
        response = await self._client._request("GET", f"/batches/{_q(batch_id)}")
        return BatchDefinition.model_validate(response.json())

    async def update(self, batch_id: str, manifest: str) -> BatchDefinition:
        response = await self._client._request(
            "PUT", f"/batches/{_q(batch_id)}", json_body={"manifest": manifest}
        )
        return BatchDefinition.model_validate(response.json())

    async def delete(self, batch_id: str) -> None:
        await self._client._request("DELETE", f"/batches/{_q(batch_id)}")

    async def versions(self, batch_id: str) -> list[BatchVersionSummary]:
        response = await self._client._request("GET", f"/batches/{_q(batch_id)}/versions")
        return [BatchVersionSummary.model_validate(row) for row in response.json()]

    async def get_version(self, batch_id: str, version: str) -> BatchDefinition:
        response = await self._client._request(
            "GET", f"/batches/{_q(batch_id)}/versions/{_q(version)}"
        )
        return BatchDefinition.model_validate(response.json())

    async def activate_version(self, batch_id: str, version: str) -> BatchDefinition:
        response = await self._client._request(
            "POST", f"/batches/{_q(batch_id)}/versions/{_q(version)}/activate"
        )
        return BatchDefinition.model_validate(response.json())

    async def set_alias(self, batch_id: str, alias: str, version: str) -> dict[str, Any]:
        response = await self._client._request(
            "PUT",
            f"/batches/{_q(batch_id)}/aliases/{_q(alias)}",
            json_body={"version": version},
        )
        return dict(response.json())

    async def remove_alias(self, batch_id: str, alias: str) -> None:
        await self._client._request("DELETE", f"/batches/{_q(batch_id)}/aliases/{_q(alias)}")

    async def run(self, *, batch_id: str, **options: Any) -> BatchRun:
        body = _without_none(
            {
                "batchId": batch_id,
                "batchVersion": options.get("batch_version"),
                "datasetId": options.get("dataset_id"),
                "datasetVersion": options.get("dataset_version"),
                "items": options.get("items"),
                "callbackUrl": options.get("callback_url"),
                "webhookSecretName": options.get("webhook_secret_name"),
            }
        )
        idempotency_key = options.get("idempotency_key")
        response = await self._client._request(
            "POST",
            "/batch-runs",
            json_body=body,
            headers={"Idempotency-Key": idempotency_key} if idempotency_key else None,
        )
        return BatchRun.model_validate(response.json())

    async def get_run(self, run_id: str) -> BatchRun:
        response = await self._client._request("GET", f"/batch-runs/{_q(run_id)}")
        return BatchRun.model_validate(response.json())

    async def list_runs(self, **filters: Any) -> BatchRunListResult:
        response = await self._client._request(
            "GET",
            _with_query(
                "/batch-runs",
                {
                    "batchId": filters.get("batch_id"),
                    "batchVersion": filters.get("batch_version"),
                    "datasetId": filters.get("dataset_id"),
                    "datasetVersion": filters.get("dataset_version"),
                    "provider": filters.get("provider"),
                    "model": filters.get("model"),
                    "status": filters.get("status"),
                    "startedAfter": filters.get("started_after"),
                    "startedBefore": filters.get("started_before"),
                    "limit": filters.get("limit"),
                    "cursor": filters.get("cursor"),
                },
            ),
        )
        return BatchRunListResult.model_validate(response.json())

    async def cancel(self, run_id: str) -> BatchRun:
        response = await self._client._request("POST", f"/batch-runs/{_q(run_id)}/cancel")
        return BatchRun.model_validate(response.json())

    async def delete_run(self, run_id: str) -> None:
        await self._client._request("DELETE", f"/batch-runs/{_q(run_id)}")

    async def items(self, run_id: str, **options: Any) -> BatchRunItemsPage:
        response = await self._client._request(
            "GET",
            _with_query(
                f"/batch-runs/{_q(run_id)}/items",
                {
                    "status": options.get("status"),
                    "limit": options.get("limit"),
                    "cursor": options.get("cursor"),
                },
            ),
        )
        return BatchRunItemsPage.model_validate(response.json())

    async def results_jsonl(self, run_id: str) -> str:
        response = await self._client._request(
            "GET",
            f"/batch-runs/{_q(run_id)}/results.jsonl",
            accept="application/x-ndjson",
        )
        return response.text

    async def compare(
        self,
        left: str,
        right: str,
        *,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> BatchRunComparisonResult:
        response = await self._client._request(
            "GET",
            _with_query(
                "/batch-runs/compare",
                {"left": left, "right": right, "limit": limit, "cursor": cursor},
            ),
        )
        return BatchRunComparisonResult.model_validate(response.json())


class EvalsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def list(self, *, agent_id: str | None = None) -> list[EvalDefinition]:
        response = self._client._request("GET", _with_query("/evals", {"agentId": agent_id}))
        return [EvalDefinition.model_validate(row) for row in response.json()]

    def create(
        self,
        definition: EvalDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDefinition:
        response = self._client._request(
            "POST",
            "/evals",
            json_body=_model_body(definition, kwargs),
        )
        return EvalDefinition.model_validate(response.json())

    def get(self, eval_id: str) -> EvalDefinition:
        response = self._client._request("GET", f"/evals/{_q(eval_id)}")
        return EvalDefinition.model_validate(response.json())

    def update(
        self,
        eval_id: str,
        patch: EvalDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDefinition:
        response = self._client._request(
            "PUT",
            f"/evals/{_q(eval_id)}",
            json_body=_model_body(patch, kwargs),
        )
        return EvalDefinition.model_validate(response.json())

    def delete(self, eval_id: str) -> None:
        self._client._request("DELETE", f"/evals/{_q(eval_id)}")

    def run(
        self,
        *,
        eval_id: str,
        dataset_id: str | None = None,
        agent_version: str | None = None,
    ) -> EvalRun:
        body: dict[str, Any] = {"evalId": eval_id}
        _add_if_defined(body, "datasetId", dataset_id)
        _add_if_defined(body, "agentVersion", agent_version)
        response = self._client._request("POST", "/eval-runs", json_body=body)
        return EvalRun.model_validate(response.json())

    def get_run(self, run_id: str) -> EvalRun:
        response = self._client._request("GET", f"/eval-runs/{_q(run_id)}")
        return EvalRun.model_validate(response.json())

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        eval_id: str | None = None,
        dataset_id: str | None = None,
        status: str | None = None,
        started_after: str | None = None,
        started_before: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> EvalRunListResult:
        response = self._client._request(
            "GET",
            _with_query(
                "/eval-runs",
                {
                    "agentId": agent_id,
                    "evalId": eval_id,
                    "datasetId": dataset_id,
                    "status": status,
                    "startedAfter": started_after,
                    "startedBefore": started_before,
                    "limit": limit,
                    "cursor": cursor,
                },
            ),
        )
        return EvalRunListResult.model_validate(response.json())

    def cancel_run(self, run_id: str) -> EvalRun:
        response = self._client._request("POST", f"/eval-runs/{_q(run_id)}/cancel")
        return EvalRun.model_validate(response.json())

    def get_latest_score(
        self,
        *,
        eval_id: str,
        dataset_id: str,
        resolved_agent_version: str | None = None,
    ) -> EvalLatestScore | None:
        response = self._client._request(
            "GET",
            _with_query(
                "/eval-scores/latest",
                {
                    "evalId": eval_id,
                    "datasetId": dataset_id,
                    "resolvedAgentVersion": resolved_agent_version,
                },
            ),
        )
        body = response.json()
        return EvalLatestScore.model_validate(body) if body is not None else None

    def list_latest_scores(
        self,
        *,
        agent_id: str | None = None,
        eval_id: str | None = None,
        dataset_id: str | None = None,
        resolved_agent_version: str | None = None,
        status: str | None = None,
    ) -> list[EvalLatestScore]:
        response = self._client._request(
            "GET",
            _with_query(
                "/eval-scores",
                {
                    "agentId": agent_id,
                    "evalId": eval_id,
                    "datasetId": dataset_id,
                    "resolvedAgentVersion": resolved_agent_version,
                    "status": status,
                },
            ),
        )
        return [EvalLatestScore.model_validate(row) for row in response.json()]


class AsyncEvalsResource:
    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def list(self, *, agent_id: str | None = None) -> list[EvalDefinition]:
        response = await self._client._request("GET", _with_query("/evals", {"agentId": agent_id}))
        return [EvalDefinition.model_validate(row) for row in response.json()]

    async def create(
        self,
        definition: EvalDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDefinition:
        response = await self._client._request(
            "POST",
            "/evals",
            json_body=_model_body(definition, kwargs),
        )
        return EvalDefinition.model_validate(response.json())

    async def get(self, eval_id: str) -> EvalDefinition:
        response = await self._client._request("GET", f"/evals/{_q(eval_id)}")
        return EvalDefinition.model_validate(response.json())

    async def update(
        self,
        eval_id: str,
        patch: EvalDefinition | Mapping[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDefinition:
        response = await self._client._request(
            "PUT",
            f"/evals/{_q(eval_id)}",
            json_body=_model_body(patch, kwargs),
        )
        return EvalDefinition.model_validate(response.json())

    async def delete(self, eval_id: str) -> None:
        await self._client._request("DELETE", f"/evals/{_q(eval_id)}")

    async def run(
        self,
        *,
        eval_id: str,
        dataset_id: str | None = None,
        agent_version: str | None = None,
    ) -> EvalRun:
        body: dict[str, Any] = {"evalId": eval_id}
        _add_if_defined(body, "datasetId", dataset_id)
        _add_if_defined(body, "agentVersion", agent_version)
        response = await self._client._request("POST", "/eval-runs", json_body=body)
        return EvalRun.model_validate(response.json())

    async def get_run(self, run_id: str) -> EvalRun:
        response = await self._client._request("GET", f"/eval-runs/{_q(run_id)}")
        return EvalRun.model_validate(response.json())

    async def list_runs(self, **filters: Any) -> EvalRunListResult:
        response = await self._client._request(
            "GET",
            _with_query(
                "/eval-runs",
                {
                    "agentId": filters.get("agent_id"),
                    "evalId": filters.get("eval_id"),
                    "datasetId": filters.get("dataset_id"),
                    "status": filters.get("status"),
                    "startedAfter": filters.get("started_after"),
                    "startedBefore": filters.get("started_before"),
                    "limit": filters.get("limit"),
                    "cursor": filters.get("cursor"),
                },
            ),
        )
        return EvalRunListResult.model_validate(response.json())

    async def cancel_run(self, run_id: str) -> EvalRun:
        response = await self._client._request("POST", f"/eval-runs/{_q(run_id)}/cancel")
        return EvalRun.model_validate(response.json())

    async def get_latest_score(
        self,
        *,
        eval_id: str,
        dataset_id: str,
        resolved_agent_version: str | None = None,
    ) -> EvalLatestScore | None:
        response = await self._client._request(
            "GET",
            _with_query(
                "/eval-scores/latest",
                {
                    "evalId": eval_id,
                    "datasetId": dataset_id,
                    "resolvedAgentVersion": resolved_agent_version,
                },
            ),
        )
        body = response.json()
        return EvalLatestScore.model_validate(body) if body is not None else None

    async def list_latest_scores(self, **filters: Any) -> list[EvalLatestScore]:
        response = await self._client._request(
            "GET",
            _with_query(
                "/eval-scores",
                {
                    "agentId": filters.get("agent_id"),
                    "evalId": filters.get("eval_id"),
                    "datasetId": filters.get("dataset_id"),
                    "resolvedAgentVersion": filters.get("resolved_agent_version"),
                    "status": filters.get("status"),
                },
            ),
        )
        return [EvalLatestScore.model_validate(row) for row in response.json()]


class RunsResource:
    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def start(
        self,
        *,
        agent_id: str,
        input: Any = None,
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        body = self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention
        )
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
        content: Sequence[Mapping[str, Any]] | None = None,
        session_id: str | None = None,
        context: list[str] | None = None,
        retention: RetentionRequest | Mapping[str, Any] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        body = await self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention
        )
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


class MemoryResource:
    """Memory admin + scope-delete over the hosted worker (bounded to the tenant's roots)."""

    def __init__(self, client: AgntzClient) -> None:
        self._client = client

    def import_(
        self,
        *,
        entries: Sequence[Mapping[str, Any]],
        dry_run: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"entries": [dict(entry) for entry in entries]}
        _add_if_defined(body, "dryRun", dry_run)
        response = self._client._request("POST", "/memory/import", json_body=body)
        return dict(response.json())

    def scan(self, grants: Sequence[str]) -> MemoryScanResult:
        path = _with_query("/memory/topics", {"grants": _csv(grants)})
        response = self._client._request("GET", path)
        return MemoryScanResult.model_validate(response.json())

    def read(
        self,
        grants: Sequence[str],
        topic: str | Sequence[str],
        *,
        limit: int | None = None,
    ) -> list[MemoryEntry]:
        topics = [topic] if isinstance(topic, str) else list(topic)
        return self._list_page(grants, topics=topics, limit=limit).entries

    def list(
        self,
        grants: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MemoryEntry]:
        return self._list_page(
            grants,
            topics=topics,
            include_superseded=include_superseded,
            limit=limit,
            offset=offset,
        ).entries

    def _list_page(
        self,
        grants: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
        limit: int | None = None,
        offset: int | None = None,
    ) -> MemoryEntriesPage:
        response = self._client._request(
            "GET", _entries_path(grants, topics, include_superseded, limit, offset)
        )
        return MemoryEntriesPage.model_validate(response.json())

    def delete_entry(self, grants: Sequence[str], entry_id: str) -> MemoryDeleteEntryResult:
        path = _with_query(f"/memory/entries/{_q(entry_id)}", {"grants": _csv(grants)})
        response = self._client._request("DELETE", path)
        return MemoryDeleteEntryResult.model_validate(response.json())

    def correct(
        self,
        grants: Sequence[str],
        entry_id: str,
        content: str,
    ) -> dict[str, MemoryEntry]:
        response = self._client._request(
            "POST",
            f"/memory/entries/{_q(entry_id)}/correct",
            json_body={"grants": list(grants), "content": content},
        )
        return {"entry": MemoryEntry.model_validate(response.json()["entry"])}

    def curate(
        self,
        grants: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
    ) -> MemoryCurateResult:
        response = self._client._request(
            "POST", "/memory/curate", json_body=_curate_body(grants, topics)
        )
        return MemoryCurateResult.model_validate(response.json())

    def delete_scope(
        self,
        grants: Sequence[str],
        prefix: str,
        *,
        recursive: bool | None = None,
    ) -> ScopeDeleteResult:
        response = self._client._request(
            "POST", "/scopes/delete", json_body=_scope_delete_body(grants, prefix, recursive)
        )
        return ScopeDeleteResult.model_validate(response.json())


class AsyncMemoryResource:
    """Async counterpart to :class:`MemoryResource`."""

    def __init__(self, client: AsyncAgntzClient) -> None:
        self._client = client

    async def import_(
        self,
        *,
        entries: Sequence[Mapping[str, Any]],
        dry_run: bool | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"entries": [dict(entry) for entry in entries]}
        _add_if_defined(body, "dryRun", dry_run)
        response = await self._client._request("POST", "/memory/import", json_body=body)
        return dict(response.json())

    async def scan(self, grants: Sequence[str]) -> MemoryScanResult:
        path = _with_query("/memory/topics", {"grants": _csv(grants)})
        response = await self._client._request("GET", path)
        return MemoryScanResult.model_validate(response.json())

    async def read(
        self,
        grants: Sequence[str],
        topic: str | Sequence[str],
        *,
        limit: int | None = None,
    ) -> list[MemoryEntry]:
        topics = [topic] if isinstance(topic, str) else list(topic)
        page = await self._list_page(grants, topics=topics, limit=limit)
        return page.entries

    async def list(
        self,
        grants: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[MemoryEntry]:
        page = await self._list_page(
            grants,
            topics=topics,
            include_superseded=include_superseded,
            limit=limit,
            offset=offset,
        )
        return page.entries

    async def _list_page(
        self,
        grants: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
        include_superseded: bool = False,
        limit: int | None = None,
        offset: int | None = None,
    ) -> MemoryEntriesPage:
        response = await self._client._request(
            "GET", _entries_path(grants, topics, include_superseded, limit, offset)
        )
        return MemoryEntriesPage.model_validate(response.json())

    async def delete_entry(self, grants: Sequence[str], entry_id: str) -> MemoryDeleteEntryResult:
        path = _with_query(f"/memory/entries/{_q(entry_id)}", {"grants": _csv(grants)})
        response = await self._client._request("DELETE", path)
        return MemoryDeleteEntryResult.model_validate(response.json())

    async def correct(
        self,
        grants: Sequence[str],
        entry_id: str,
        content: str,
    ) -> dict[str, MemoryEntry]:
        response = await self._client._request(
            "POST",
            f"/memory/entries/{_q(entry_id)}/correct",
            json_body={"grants": list(grants), "content": content},
        )
        return {"entry": MemoryEntry.model_validate(response.json()["entry"])}

    async def curate(
        self,
        grants: Sequence[str],
        *,
        topics: Sequence[str] | None = None,
    ) -> MemoryCurateResult:
        response = await self._client._request(
            "POST", "/memory/curate", json_body=_curate_body(grants, topics)
        )
        return MemoryCurateResult.model_validate(response.json())

    async def delete_scope(
        self,
        grants: Sequence[str],
        prefix: str,
        *,
        recursive: bool | None = None,
    ) -> ScopeDeleteResult:
        response = await self._client._request(
            "POST", "/scopes/delete", json_body=_scope_delete_body(grants, prefix, recursive)
        )
        return ScopeDeleteResult.model_validate(response.json())


def _run_attached_sync(
    client: AgntzClient,
    body: Mapping[str, Any],
    handlers: ClientToolHandlers,
) -> RunResult:
    response = client._stream("POST", "/run/stream", json_body=body)
    stream_context = response.extensions["_agntz_stream_context"]
    try:
        for frame in parse_sse(response.iter_text()):
            if frame.event == "client-tool-request":
                _handle_client_tool_sync(client, frame.data, handlers)
                continue
            if frame.event == "run-complete":
                return RunResult.model_validate(_frame_json(frame.data, frame.event))
            if frame.event == "run-error":
                payload = _frame_json(frame.data, frame.event)
                raise StreamError(str(payload.get("error") or "Run failed"))
        raise StreamError("Stream closed before completion", code="STREAM_TRUNCATED")
    finally:
        stream_context.__exit__(None, None, None)


async def _run_attached_async(
    client: AsyncAgntzClient,
    body: Mapping[str, Any],
    handlers: ClientToolHandlers,
) -> RunResult:
    async with client._client.stream(
        "POST",
        _join_url(client._base_url, "/run/stream"),
        headers=_headers(client._api_key, "text/event-stream"),
        json=dict(body),
    ) as response:
        _raise_for_status(response)
        async for frame in parse_sse_async(response.aiter_text()):
            if frame.event == "client-tool-request":
                await _handle_client_tool_async(client, frame.data, handlers)
                continue
            if frame.event == "run-complete":
                return RunResult.model_validate(_frame_json(frame.data, frame.event))
            if frame.event == "run-error":
                payload = _frame_json(frame.data, frame.event)
                raise StreamError(str(payload.get("error") or "Run failed"))
    raise StreamError("Stream closed before completion", code="STREAM_TRUNCATED")


def _handle_client_tool_sync(
    client: AgntzClient,
    data: str,
    handlers: ClientToolHandlers,
) -> None:
    request = _frame_json(data, "client-tool-request")
    name = str(request.get("name") or "")
    handler = handlers.get(name)
    output: Any = None
    error: str | None = None
    if handler is None:
        error = f"No handler was supplied for client tool '{name}'"
    else:
        signal = threading.Event()
        context = ClientToolContext(
            request_id=str(request["requestId"]),
            tool_call_id=str(request["toolCallId"]),
            run_id=str(request["runId"]),
            deadline_at=str(request["deadlineAt"]),
            signal=signal,
        )
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(_invoke_sync_client_tool, handler, request.get("input"), context)
        try:
            output = future.result(timeout=_remaining_seconds(context.deadline_at))
            _validate_client_tool_output(name, output)
        except concurrent.futures.TimeoutError:
            signal.set()
            error = f"Client tool '{name}' timed out"
        except Exception as exc:
            error = str(exc)
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
    _submit_client_tool_result_sync(client, request, output, error)


async def _handle_client_tool_async(
    client: AsyncAgntzClient,
    data: str,
    handlers: ClientToolHandlers,
) -> None:
    request = _frame_json(data, "client-tool-request")
    name = str(request.get("name") or "")
    handler = handlers.get(name)
    output: Any = None
    error: str | None = None
    if handler is None:
        error = f"No handler was supplied for client tool '{name}'"
    else:
        signal = asyncio.Event()
        context = ClientToolContext(
            request_id=str(request["requestId"]),
            tool_call_id=str(request["toolCallId"]),
            run_id=str(request["runId"]),
            deadline_at=str(request["deadlineAt"]),
            signal=signal,
        )
        try:
            async with asyncio.timeout(_remaining_seconds(context.deadline_at)):
                if inspect.iscoroutinefunction(handler):
                    output = await handler(request.get("input"), context)
                else:
                    output = await asyncio.to_thread(handler, request.get("input"), context)
                    if inspect.isawaitable(output):
                        output = await output
            _validate_client_tool_output(name, output)
        except TimeoutError:
            signal.set()
            error = f"Client tool '{name}' timed out"
        except Exception as exc:
            error = str(exc)
    await _submit_client_tool_result_async(client, request, output, error)


def _invoke_sync_client_tool(
    handler: ClientToolHandler,
    input_value: Any,
    context: ClientToolContext,
) -> Any:
    output = handler(input_value, context)
    if inspect.isawaitable(output):
        return asyncio.run(_await_client_tool_output(output))
    return output


async def _await_client_tool_output(output: Awaitable[Any]) -> Any:
    return await output


def _validate_client_tool_output(name: str, output: Any) -> None:
    try:
        serialized = json.dumps(output, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise TypeError(f"Client tool '{name}' returned a non-JSON-serializable value") from exc
    if len(serialized) > CLIENT_TOOL_RESULT_MAX_CHARS:
        raise ValueError(
            f"Client tool '{name}' output exceeds "
            f"{CLIENT_TOOL_RESULT_MAX_CHARS} serialized characters"
        )


def _submit_client_tool_result_sync(
    client: AgntzClient,
    request: Mapping[str, Any],
    output: Any,
    error: str | None,
) -> None:
    path = _client_tool_result_path(request)
    body = {"output": output} if error is None else {"error": error}
    for attempt, delay in enumerate((0.1, 0.25, 0.0)):
        try:
            client._request("POST", path, json_body=body)
            return
        except AgntzError as exc:
            if exc.status == 410:
                return
            transient = exc.status == 429 or (exc.status is not None and exc.status >= 500)
            if not transient or attempt == 2:
                raise
            time.sleep(delay)


async def _submit_client_tool_result_async(
    client: AsyncAgntzClient,
    request: Mapping[str, Any],
    output: Any,
    error: str | None,
) -> None:
    path = _client_tool_result_path(request)
    body = {"output": output} if error is None else {"error": error}
    for attempt, delay in enumerate((0.1, 0.25, 0.0)):
        try:
            await client._request("POST", path, json_body=body)
            return
        except AgntzError as exc:
            if exc.status == 410:
                return
            transient = exc.status == 429 or (exc.status is not None and exc.status >= 500)
            if not transient or attempt == 2:
                raise
            await asyncio.sleep(delay)


def _client_tool_result_path(request: Mapping[str, Any]) -> str:
    return (
        f"/runs/{_q(str(request['rootRunId']))}/client-tool-requests/"
        f"{_q(str(request['requestId']))}/result"
    )


def _remaining_seconds(deadline_at: str) -> float:
    deadline = datetime.fromisoformat(deadline_at.replace("Z", "+00:00")).timestamp()
    return max(0.0, deadline - time.time())


def _frame_json(data: str, event: str | None) -> dict[str, Any]:
    try:
        value = json.loads(data)
    except (TypeError, json.JSONDecodeError) as exc:
        raise StreamError(f"Invalid {event or 'SSE'} event payload", cause=exc) from exc
    if not isinstance(value, dict):
        raise StreamError(f"Invalid {event or 'SSE'} event payload")
    return value


def _csv(values: Sequence[str]) -> str:
    return ",".join(values)


def _entries_path(
    grants: Sequence[str],
    topics: Sequence[str] | None,
    include_superseded: bool,
    limit: int | None,
    offset: int | None,
) -> str:
    return _with_query(
        "/memory/entries",
        {
            "grants": _csv(grants),
            "topics": _csv(topics) if topics else None,
            "includeSuperseded": True if include_superseded else None,
            "limit": limit,
            "offset": offset,
        },
    )


def _curate_body(grants: Sequence[str], topics: Sequence[str] | None) -> dict[str, Any]:
    body: dict[str, Any] = {"grants": list(grants)}
    if topics is not None:
        body["topics"] = list(topics)
    return body


def _scope_delete_body(
    grants: Sequence[str],
    prefix: str,
    recursive: bool | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"scope": prefix, "grants": list(grants)}
    if recursive is not None:
        body["recursive"] = recursive
    return body


def _is_content_blocks(value: Any) -> bool:
    return isinstance(value, list) and all(
        isinstance(block, Mapping) and block.get("type") in {"text", "image", "audio"}
        for block in value
    )


def _retention_artifact_ttl(
    retention: RetentionRequest | Mapping[str, Any] | None,
) -> int | None:
    if retention is None:
        return None
    if isinstance(retention, RetentionRequest):
        return retention.artifact_ttl_seconds
    value = retention.get("artifactTtlSeconds", retention.get("artifact_ttl_seconds"))
    return int(value) if value is not None else None


def _retention_body(
    retention: RetentionRequest | Mapping[str, Any],
) -> dict[str, Any]:
    if isinstance(retention, RetentionRequest):
        return retention.model_dump(by_alias=True, exclude_none=True)
    return {
        _snake_to_camel(str(key)): value for key, value in retention.items() if value is not None
    }


def _artifact_payload(
    file: Any,
    *,
    media_type: str | None,
    filename: str | None,
) -> tuple[bytes, str, str]:
    source = file
    if isinstance(file, Mapping):
        source = file.get("path")
        media_type = media_type or file.get("mediaType") or file.get("media_type")
        filename = filename or file.get("filename")

    if isinstance(source, (str, Path)):
        path = Path(source)
        payload = path.read_bytes()
        filename = filename or path.name
        media_type = media_type or mimetypes.guess_type(path.name)[0]
    elif isinstance(source, bytes):
        payload = source
    elif isinstance(source, (bytearray, memoryview)):
        payload = bytes(source)
    elif callable(reader := getattr(source, "read", None)):
        payload = reader()
        if isinstance(payload, str):
            payload = payload.encode()
        if not isinstance(payload, bytes):
            raise TypeError("Artifact file.read() must return bytes")
        filename = filename or getattr(source, "name", None)
        if filename:
            filename = Path(str(filename)).name
    else:
        raise TypeError("Artifact file must be bytes, a path, or a binary file object")

    resolved_filename = filename or "artifact"
    resolved_media_type = media_type or mimetypes.guess_type(resolved_filename)[0]
    return payload, resolved_filename, resolved_media_type or "application/octet-stream"


def _parse_dataset_source(
    source: str | Path | Sequence[Mapping[str, Any]],
    format: str | None,
    id_column: str,
    input_column: str,
) -> list[dict[str, Any]]:
    if isinstance(source, Path):
        text = source.read_text()
        resolved_format = format or source.suffix.lstrip(".").lower()
    elif isinstance(source, str):
        text = source
        resolved_format = format
    else:
        return _validate_dataset_items([dict(item) for item in source])

    if resolved_format is None:
        first = next((line.strip() for line in text.splitlines() if line.strip()), "")
        resolved_format = "jsonl" if first.startswith("{") else "csv"
    if resolved_format not in {"jsonl", "csv"}:
        raise ValueError("Dataset format must be 'jsonl' or 'csv'")

    items: list[dict[str, Any]] = []
    if resolved_format == "jsonl":
        for index, line in enumerate(text.splitlines()):
            if not line.strip():
                continue
            value = json.loads(line)
            if isinstance(value, dict) and "input" in value:
                item = {
                    "id": value.get("id") or f"row_{index + 1:06d}",
                    "input": value["input"],
                }
                if value.get("name") is not None:
                    item["name"] = value["name"]
                if value.get("metadata") is not None:
                    item["metadata"] = value["metadata"]
            else:
                item = {"id": f"row_{index + 1:06d}", "input": value}
            items.append(item)
    else:
        for index, row in enumerate(csv.DictReader(io.StringIO(text))):
            item_id = (row.get(id_column) or "").strip() or f"row_{index + 1:06d}"
            raw_input = row.get(input_column)
            if raw_input is None:
                item_input: Any = {key: value for key, value in row.items() if key != id_column}
            else:
                item_input = _parse_maybe_json(raw_input)
            item = {"id": item_id, "input": item_input}
            if row.get("name"):
                item["name"] = row["name"]
            metadata = {
                key: value
                for key, value in row.items()
                if key not in {id_column, input_column, "name"}
            }
            if metadata:
                item["metadata"] = metadata
            items.append(item)
    return _validate_dataset_items(items)


def _parse_maybe_json(value: str) -> Any:
    stripped = value.strip()
    if stripped.startswith(("{", "[")):
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
    return value


def _validate_dataset_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not items:
        raise ValueError("Dataset import contains no items")
    ids: set[str] = set()
    for index, item in enumerate(items):
        item_id = item.get("id")
        if not isinstance(item_id, str) or not item_id:
            raise ValueError(f"Dataset item {index + 1} has no id")
        if item_id in ids:
            raise ValueError(f"Duplicate dataset item id '{item_id}'")
        if "input" not in item:
            raise ValueError(f"Dataset item '{item_id}' has no input")
        ids.add(item_id)
    return items


def _without_none(value: Mapping[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _add_if_defined(body: dict[str, Any], key: str, value: Any) -> None:
    if value is not None:
        body[key] = value


def _model_body(
    value: Any,
    kwargs: Mapping[str, Any],
) -> dict[str, Any]:
    if value is None:
        body: dict[str, Any] = {}
    elif hasattr(value, "model_dump"):
        body = value.model_dump(by_alias=True, exclude_none=True)
    else:
        body = dict(value)
    for key, item in kwargs.items():
        if item is not None:
            body[_snake_to_camel(key)] = item
    return body


def _snake_to_camel(value: str) -> str:
    if "_" not in value:
        return value
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _q(value: str) -> str:
    return quote(value, safe="")


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
    message, code = _read_error(response)
    if response.status_code == 401:
        raise AuthenticationError(message, status=response.status_code, code=code)
    if response.status_code == 404:
        raise NotFoundError(message, status=response.status_code, code=code)
    raise AgntzError(message, status=response.status_code, code=code)


def _read_error(response: httpx.Response) -> tuple[str, str | None]:
    try:
        body = response.json()
    except ValueError:
        return f"HTTP {response.status_code}", None
    if isinstance(body, dict) and isinstance(body.get("error"), str):
        code = body.get("code")
        return body["error"], code if isinstance(code, str) else None
    return f"HTTP {response.status_code}", None
