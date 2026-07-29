"""Hosted Agntz client."""

from __future__ import annotations

import asyncio
import mimetypes
from collections.abc import AsyncIterator, Iterator, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from ._sse import parse_sse, parse_sse_async
from .errors import AgntzError, AuthenticationError, NotFoundError, StreamError
from .events import normalize_agent_event, normalize_run_event, normalize_trace_event
from .models import (
    AgentDefinition,
    AgentVersionSummary,
    ArtifactRef,
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

    def _prepare_run_body(
        self,
        agent_id: str,
        input: Any,
        content: Sequence[Mapping[str, Any]] | None,
        session_id: str | None,
        context: list[str] | None,
        retention: RetentionRequest | Mapping[str, Any] | None,
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
    ) -> httpx.Response:
        response = await self._client.request(
            method,
            _join_url(self._base_url, path),
            headers=_headers(self._api_key if auth else None, accept),
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
    ) -> RunResult:
        body = self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention
        )
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
    ) -> Iterator[Event]:
        body = self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention
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
    ) -> RunResult:
        body = await self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention
        )
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
    ) -> AsyncIterator[Event]:
        body = await self._client._prepare_run_body(
            agent_id, input, content, session_id, context, retention
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
        response = self._client._request("GET", _entries_path(
            grants, topics, include_superseded, limit, offset
        ))
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
        response = await self._client._request("GET", _entries_path(
            grants, topics, include_superseded, limit, offset
        ))
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
        _snake_to_camel(str(key)): value
        for key, value in retention.items()
        if value is not None
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
