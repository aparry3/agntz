"""Hosted Agntz client."""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator, Mapping
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from ._sse import parse_sse, parse_sse_async
from .errors import AgntzError, AuthenticationError, NotFoundError, StreamError
from .events import normalize_agent_event, normalize_run_event, normalize_trace_event
from .models import (
    AgentDefinition,
    AgentVersionSummary,
    EvalDataset,
    EvalDefinition,
    EvalLatestScore,
    EvalRun,
    EvalRunListResult,
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
        self.datasets = DatasetsResource(self)
        self.evals = EvalsResource(self)
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
        self.datasets = AsyncDatasetsResource(self)
        self.evals = AsyncEvalsResource(self)
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

    def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> RunResult:
        response = self._client._request(
            "POST",
            "/run",
            json_body=_run_body(agent_id, input, session_id, context),
        )
        return RunResult.model_validate(response.json())

    def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> Iterator[Event]:
        response = self._client._stream(
            "POST",
            "/run/stream",
            json_body=_run_body(agent_id, input, session_id, context),
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

    def list(self) -> list[dict[str, Any]]:
        response = self._client._request("GET", "/agents")
        return list(response.json())

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
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> RunResult:
        response = await self._client._request(
            "POST",
            "/run",
            json_body=_run_body(agent_id, input, session_id, context),
        )
        return RunResult.model_validate(response.json())

    async def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> AsyncIterator[Event]:
        async with self._client._client.stream(
            "POST",
            _join_url(self._client._base_url, "/run/stream"),
            headers=_headers(self._client._api_key, "text/event-stream"),
            json=_run_body(agent_id, input, session_id, context),
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

    async def list(self) -> list[dict[str, Any]]:
        response = await self._client._request("GET", "/agents")
        return list(response.json())

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
        session_id: str | None = None,
        context: list[str] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        body = _run_body(agent_id, input, session_id, context)
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
        context: list[str] | None = None,
        callback_url: str | None = None,
        webhook_secret_name: str | None = None,
    ) -> Run:
        body = _run_body(agent_id, input, session_id, context)
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


def _run_body(
    agent_id: str,
    input: Any,
    session_id: str | None,
    context: list[str] | None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"agentId": agent_id}
    _add_if_defined(body, "input", input)
    _add_if_defined(body, "sessionId", session_id)
    _add_if_defined(body, "context", context)
    return body


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
