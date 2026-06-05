"""Embedded local SDK entrypoint."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import time
from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import httpx
from pydantic import BaseModel

from agntz.agent_ref import is_iso_timestamp, parse_agent_ref
from agntz.client.models import AgentDefinition as StoredAgentDefinition
from agntz.client.models import (
    EvalDataset,
    EvalDefinition,
    EvalLatestScore,
    EvalRun,
    EvalRunListResult,
    Event,
    RunResult,
)
from agntz.client.models import (
    ModelConfig as StoredModelConfig,
)
from agntz.context import NamespaceGrantPolicyLike, normalize_namespace_grants
from agntz.core import (
    GenerateTextResult,
    MissingModelProvider,
    ModelMessage,
    ModelProvider,
    ModelTool,
    ResolvedResource,
    ResourceMode,
    ResourceProvider,
    ResourceProviderToolDefinition,
    ResourceRegistrationContext,
    ResourceToolContext,
    ToolCall,
    ToolDefinition,
    ToolResult,
    clamp_resource_mode,
    invoke_http_tool,
    invoke_mcp_tool,
    make_resource_tool_name,
)
from agntz.core.ids import nanoid
from agntz.core.ids import run_id as new_run_id
from agntz.core.ids import session_id as new_session_id
from agntz.core.ids import trace_id as new_trace_id
from agntz.evals import TargetInvocation, latest_score_from_eval_run, run_eval
from agntz.manifest import execute
from agntz.manifest.parser import load_manifest_file, parse_manifest
from agntz.manifest.types import (
    AgentManifest,
    AgentState,
    LLMAgentManifest,
    ToolCallConfig,
)
from agntz.stores import (
    LocalMessageRecord,
    LocalRunRecord,
    LocalSessionSummary,
    LocalTraceRecord,
    LocalTraceSpanRecord,
    MemoryStore,
    RunStore,
)


class LocalClient:
    def __init__(
        self,
        *,
        manifests: dict[str, AgentManifest],
        tools: dict[str, ToolDefinition],
        model_provider: ModelProvider | None,
        resources: Mapping[str, ResourceProvider] | None = None,
        namespace_policy: NamespaceGrantPolicyLike = None,
        store: RunStore | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.manifests = manifests
        self.tools = tools
        self.resource_providers = dict(resources or {})
        self.namespace_policy = namespace_policy
        self.model_provider = model_provider or MissingModelProvider()
        self.store: Any = store or MemoryStore()
        self.http_client = http_client
        self.agents = LocalAgentsResource(self)
        self.datasets = LocalDatasetsResource(self)
        self.evals = LocalEvalsResource(self)
        self.runs = LocalRunsResource(self)
        self.sessions = LocalSessionsResource(self)
        self.traces = LocalTracesResource(self)

    async def _execute(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> RunResult:
        manifest, resolved_agent, _resolved_version = self._resolve_manifest(agent_id)
        base_agent_id = resolved_agent.id
        resolved_session_id = session_id or new_session_id()
        normalized_context = normalize_namespace_grants(context, self.namespace_policy)
        local_run_id = new_run_id()
        local_trace_id = new_trace_id()
        started_at = time.time()
        ctx = _LocalExecutionContext(
            self,
            agent_id=base_agent_id,
            session_id=resolved_session_id,
            run_id=local_run_id,
            trace_id=local_trace_id,
            context=normalized_context,
        )
        self.store.append_messages(
            resolved_session_id,
            [
                LocalMessageRecord(
                    session_id=resolved_session_id,
                    agent_id=base_agent_id,
                    role="user",
                    content=_message_content(input),
                    timestamp=_iso_now(),
                )
            ],
            agent_id=base_agent_id,
        )
        self.store.put_run(
            LocalRunRecord(
                id=local_run_id,
                root_id=local_run_id,
                agent_id=base_agent_id,
                session_id=resolved_session_id,
                status="running",
                input=input,
            )
        )
        self.store.put_trace(
            LocalTraceRecord(
                trace_id=local_trace_id,
                run_id=local_run_id,
                agent_id=base_agent_id,
                session_id=resolved_session_id,
                status="running",
                started_at=started_at,
            )
        )
        try:
            result = await execute(manifest, input, ctx)
        except Exception as exc:
            self.store.put_run(
                LocalRunRecord(
                    id=local_run_id,
                    root_id=local_run_id,
                    agent_id=base_agent_id,
                    session_id=resolved_session_id,
                    status="failed",
                    input=input,
                    error=str(exc),
                )
            )
            self.store.put_trace(
                LocalTraceRecord(
                    trace_id=local_trace_id,
                    run_id=local_run_id,
                    agent_id=base_agent_id,
                    session_id=resolved_session_id,
                    status="error",
                    started_at=started_at,
                    ended_at=time.time(),
                    error=str(exc),
                )
            )
            raise
        self.store.put_run(
            LocalRunRecord(
                id=local_run_id,
                root_id=local_run_id,
                agent_id=base_agent_id,
                session_id=resolved_session_id,
                status="completed",
                input=input,
                output=result.output,
            )
        )
        self.store.append_messages(
            resolved_session_id,
            [
                LocalMessageRecord(
                    session_id=resolved_session_id,
                    agent_id=base_agent_id,
                    role="assistant",
                    content=_message_content(result.output),
                    timestamp=_iso_now(),
                )
            ],
            agent_id=base_agent_id,
        )
        self.store.put_trace(
            LocalTraceRecord(
                trace_id=local_trace_id,
                run_id=local_run_id,
                agent_id=base_agent_id,
                session_id=resolved_session_id,
                status="ok",
                started_at=started_at,
                ended_at=time.time(),
                output=result.output,
            )
        )
        return RunResult(output=result.output, state=result.state, sessionId=resolved_session_id)

    def _resolve_manifest(
        self,
        agent_ref: str,
    ) -> tuple[AgentManifest, StoredAgentDefinition, str | None]:
        ref = parse_agent_ref(agent_ref)
        version = ref.version
        agent: StoredAgentDefinition | None = None
        resolved_version: str | None = None
        if version is None:
            store: Any = self.store
            getter = getattr(store, "get_agent", None)
            agent = (
                cast(StoredAgentDefinition | None, getter(ref.agent_id))
                if callable(getter)
                else None
            )
            resolved_version = agent.created_at if agent else None
        elif version == "latest":
            store = self.store
            list_versions = getattr(store, "list_agent_versions", None)
            get_version = getattr(store, "get_agent_version", None)
            versions = cast(
                list[Any],
                list_versions(ref.agent_id) if callable(list_versions) else [],
            )
            resolved_version = versions[0].created_at if versions else None
            agent = (
                cast(StoredAgentDefinition | None, get_version(ref.agent_id, resolved_version))
                if callable(get_version) and resolved_version
                else None
            )
        elif is_iso_timestamp(version):
            store = self.store
            get_version = getattr(store, "get_agent_version", None)
            resolved_version = version
            agent = (
                cast(StoredAgentDefinition | None, get_version(ref.agent_id, version))
                if callable(get_version)
                else None
            )
        else:
            store = self.store
            resolve_alias = getattr(store, "resolve_agent_alias", None)
            get_version = getattr(store, "get_agent_version", None)
            resolved_version = (
                cast(str | None, resolve_alias(ref.agent_id, version))
                if callable(resolve_alias)
                else None
            )
            agent = (
                cast(StoredAgentDefinition | None, get_version(ref.agent_id, resolved_version))
                if callable(get_version) and resolved_version
                else None
            )
        if agent is None:
            manifest = self.manifests.get(ref.agent_id)
            if manifest is None:
                raise KeyError(agent_ref)
            agent = _agent_definition_from_manifest(manifest, None)
            resolved_version = None
            return manifest, agent, resolved_version
        manifest_source = (agent.metadata or {}).get("manifest")
        if isinstance(manifest_source, str):
            manifest = parse_manifest(manifest_source)
        else:
            manifest = self.manifests.get(agent.id)
            if manifest is None:
                raise KeyError(agent_ref)
        self.manifests[agent.id] = manifest
        return manifest, agent, resolved_version

    def _resolve_agent_definition(self, agent_ref: str) -> tuple[StoredAgentDefinition, str | None]:
        _manifest, agent, resolved_version = self._resolve_manifest(agent_ref)
        return agent, resolved_version


class LocalAgentsResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def run(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> RunResult:
        return _run_blocking(
            self._client._execute(
                agent_id=agent_id,
                input=input,
                session_id=session_id,
                context=context,
            )
        )

    async def arun(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> RunResult:
        return await self._client._execute(
            agent_id=agent_id,
            input=input,
            session_id=session_id,
            context=context,
        )

    def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
        context: list[str] | None = None,
    ) -> Iterator[Event]:
        resolved_session_id = session_id or new_session_id()
        manifest, resolved_agent, _version = self._client._resolve_manifest(agent_id)
        yield Event(
            type="start",
            agentId=resolved_agent.id,
            kind=manifest.kind,
            sessionId=resolved_session_id,
        )
        result = self.run(
            agent_id=agent_id,
            input=input,
            session_id=resolved_session_id,
            context=context,
        )
        yield Event(
            type="complete",
            output=result.output,
            state=result.state,
            sessionId=result.session_id,
        )

    def list(self) -> list[dict[str, Any]]:
        list_agents = self._client.store.list_agents
        return list_agents()

    def get(self, agent_id: str) -> StoredAgentDefinition | None:
        ref = parse_agent_ref(agent_id)
        getter = self._client.store.get_agent
        return getter(ref.agent_id)

    def create(
        self,
        agent: StoredAgentDefinition | dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> StoredAgentDefinition:
        payload = _merge_payload(agent, kwargs)
        stored = _agent_from_payload(payload)
        result = self._client.store.put_agent(stored)
        manifest_source = (result.metadata or {}).get("manifest")
        if isinstance(manifest_source, str):
            self._client.manifests[result.id] = parse_manifest(manifest_source)
        return result

    def update(
        self,
        agent_id: str,
        patch: StoredAgentDefinition | dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> StoredAgentDefinition:
        existing = self.get(agent_id)
        if existing is None:
            raise KeyError(agent_id)
        payload = existing.model_dump(by_alias=True, exclude_none=True)
        payload.update(_merge_payload(patch, kwargs))
        payload["id"] = parse_agent_ref(agent_id).agent_id
        return self.create(payload)

    def delete(self, agent_id: str) -> None:
        ref = parse_agent_ref(agent_id)
        self._client.store.delete_agent(ref.agent_id)
        self._client.manifests.pop(ref.agent_id, None)

    def list_versions(self, agent_id: str) -> list[Any]:
        return self._client.store.list_agent_versions(parse_agent_ref(agent_id).agent_id)

    def get_version(self, agent_id: str, created_at: str) -> StoredAgentDefinition | None:
        return self._client.store.get_agent_version(parse_agent_ref(agent_id).agent_id, created_at)

    def activate_version(self, agent_id: str, created_at: str) -> None:
        self._client.store.activate_agent_version(parse_agent_ref(agent_id).agent_id, created_at)

    def set_alias(self, agent_id: str, alias: str, created_at: str) -> dict[str, str]:
        base = parse_agent_ref(agent_id).agent_id
        self._client.store.set_agent_version_alias(base, created_at, alias)
        return {"agentId": base, "alias": alias, "createdAt": created_at}

    def remove_alias(self, agent_id: str, alias: str) -> dict[str, Any]:
        base = parse_agent_ref(agent_id).agent_id
        self._client.store.remove_agent_version_alias(base, alias)
        return {"agentId": base, "alias": alias, "removed": True}


class LocalDatasetsResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def list(self, *, agent_id: str | None = None) -> list[EvalDataset]:
        return self._client.store.list_datasets(agent_id=agent_id)

    def create(
        self,
        dataset: EvalDataset | dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDataset:
        normalized = _dataset_from_payload(_merge_payload(dataset, kwargs))
        return self._client.store.put_dataset(normalized)

    def get(self, dataset_id: str) -> EvalDataset | None:
        return self._client.store.get_dataset(dataset_id)

    def update(
        self,
        dataset_id: str,
        patch: EvalDataset | dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDataset:
        existing = self.get(dataset_id)
        if existing is None:
            raise KeyError(dataset_id)
        payload = existing.model_dump(by_alias=True, exclude_none=True)
        payload.update(_merge_payload(patch, kwargs))
        payload["id"] = dataset_id
        return self.create(payload)

    def delete(self, dataset_id: str) -> None:
        self._client.store.delete_dataset(dataset_id)


class LocalEvalsResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def list(self, *, agent_id: str | None = None) -> list[EvalDefinition]:
        return self._client.store.list_evals(agent_id=agent_id)

    def create(
        self,
        definition: EvalDefinition | dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDefinition:
        normalized = _eval_from_payload(_merge_payload(definition, kwargs))
        _assert_eval_dataset_scope(self._client.store, normalized)
        return self._client.store.put_eval(normalized)

    def get(self, eval_id: str) -> EvalDefinition | None:
        return self._client.store.get_eval(eval_id)

    def update(
        self,
        eval_id: str,
        patch: EvalDefinition | dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> EvalDefinition:
        existing = self.get(eval_id)
        if existing is None:
            raise KeyError(eval_id)
        payload = existing.model_dump(by_alias=True, exclude_none=True)
        payload.update(_merge_payload(patch, kwargs))
        payload["id"] = eval_id
        return self.create(payload)

    def delete(self, eval_id: str) -> None:
        self._client.store.delete_eval(eval_id)

    def run(
        self,
        *,
        eval_id: str,
        dataset_id: str | None = None,
        agent_version: str | None = None,
    ) -> EvalRun:
        return _run_blocking(
            self.arun(
                eval_id=eval_id,
                dataset_id=dataset_id,
                agent_version=agent_version,
            )
        )

    async def arun(
        self,
        *,
        eval_id: str,
        dataset_id: str | None = None,
        agent_version: str | None = None,
    ) -> EvalRun:
        async def invoke_target(agent_ref: str, input_value: Any) -> TargetInvocation:
            result = await self._client._execute(agent_id=agent_ref, input=input_value)
            ref = parse_agent_ref(agent_ref)
            runs = self._client.store.list_runs(agent_id=ref.agent_id, status="completed")
            linked_run_id = runs[-1].id if runs else None
            return TargetInvocation(output=result.output, run_id=linked_run_id)

        return await run_eval(
            self._client.store,
            eval_id=eval_id,
            dataset_id=dataset_id,
            agent_version=agent_version,
            resolve_agent=self._client._resolve_agent_definition,
            invoke_target=invoke_target,
        )

    def get_run(self, run_id: str) -> EvalRun | None:
        return self._client.store.get_eval_run(run_id)

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
        return self._client.store.list_eval_runs(
            agent_id=agent_id,
            eval_id=eval_id,
            dataset_id=dataset_id,
            status=status,
            started_after=started_after,
            started_before=started_before,
            limit=limit,
            cursor=cursor,
        )

    def cancel_run(self, run_id: str) -> EvalRun | None:
        run = self.get_run(run_id)
        if run is None:
            return None
        if run.status in {"completed", "failed", "cancelled"}:
            return run
        run.status = "cancelled"
        run.ended_at = _iso_now_z()
        self._client.store.put_eval_run(run)
        self._client.store.put_eval_latest_score(latest_score_from_eval_run(run))
        return run

    def get_latest_score(
        self,
        *,
        eval_id: str,
        dataset_id: str,
        resolved_agent_version: str | None = None,
    ) -> EvalLatestScore | None:
        return self._client.store.get_eval_latest_score(
            eval_id=eval_id,
            dataset_id=dataset_id,
            resolved_agent_version=resolved_agent_version,
        )

    def list_latest_scores(
        self,
        *,
        agent_id: str | None = None,
        eval_id: str | None = None,
        dataset_id: str | None = None,
        resolved_agent_version: str | None = None,
        status: str | None = None,
    ) -> list[EvalLatestScore]:
        return self._client.store.list_eval_latest_scores(
            agent_id=agent_id,
            eval_id=eval_id,
            dataset_id=dataset_id,
            resolved_agent_version=resolved_agent_version,
            status=status,
        )


class LocalRunsResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def get(self, run_id: str) -> LocalRunRecord | None:
        return self._client.store.get_run(run_id)

    def list(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> list[LocalRunRecord]:
        return self._client.store.list_runs(agent_id=agent_id, status=status)


class LocalSessionsResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def list(
        self,
        *,
        agent_id: str | None = None,
    ) -> list[LocalSessionSummary]:
        return self._client.store.list_sessions(agent_id=agent_id)

    def get_messages(self, session_id: str) -> list[LocalMessageRecord]:
        return self._client.store.get_messages(session_id)

    def delete(self, session_id: str) -> None:
        self._client.store.delete_session(session_id)


class LocalTracesResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def list(
        self,
        *,
        agent_id: str | None = None,
        status: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        return {
            "rows": [
                self._summary(trace)
                for trace in self._client.store.list_traces(agent_id=agent_id, status=status)
            ]
        }

    def get(self, trace_id: str) -> dict[str, Any] | None:
        trace = self._client.store.get_trace(trace_id)
        if trace is None:
            return None
        child_spans = self._client.store.list_trace_spans(trace_id)
        spans = [_trace_span(trace)] + [span.as_dict() for span in child_spans]
        return {"summary": self._summary(trace), "spans": spans}

    def stream(self, trace_id: str) -> Iterator[Event]:
        detail = self.get(trace_id)
        if detail is not None:
            yield Event(type="snapshot", summary=detail["summary"], spans=detail["spans"])

    def _summary(self, trace: LocalTraceRecord) -> dict[str, Any]:
        child_spans = self._client.store.list_trace_spans(trace.trace_id)
        total_tokens = 0
        total_cost_usd = 0.0
        has_cost = False
        for span in child_spans:
            attributes = span.attributes or {}
            usage = attributes.get("usage")
            if isinstance(usage, dict):
                total = usage.get("totalTokens")
                if isinstance(total, int):
                    total_tokens += total
            if span.cost_usd is not None:
                total_cost_usd += span.cost_usd
                has_cost = True
        return trace.summary(
            span_count=1 + len(child_spans),
            total_tokens=total_tokens,
            total_cost_usd=total_cost_usd if has_cost else None,
        )


def _trace_span(trace: LocalTraceRecord) -> dict[str, Any]:
    return {
        "spanId": trace.trace_id,
        "traceId": trace.trace_id,
        "parentId": None,
        "ownerId": "local",
        "runId": trace.run_id,
        "sessionId": trace.session_id,
        "name": trace.agent_id,
        "kind": "run",
        "startedAt": trace.started_at,
        "endedAt": trace.ended_at,
        "durationMs": _duration_ms(trace.started_at, trace.ended_at),
        "status": trace.status,
        "error": trace.error,
        "attributes": {"agentId": trace.agent_id},
        "events": [],
        "scores": {},
        "costUsd": None,
    }


class _LocalExecutionContext:
    def __init__(
        self,
        client: LocalClient,
        *,
        agent_id: str,
        session_id: str,
        run_id: str,
        trace_id: str,
        context: list[str],
    ) -> None:
        self._client = client
        self.agent_id = agent_id
        self.session_id = session_id
        self.run_id = run_id
        self.trace_id = trace_id
        self.context = context
        self.invocation_id = f"inv_{nanoid()}"
        self._parent_resource_modes_stack: list[dict[str, ResourceMode]] = []

    async def invoke_llm(
        self,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> Any:
        resources = self._resolved_resources_for_manifest(manifest)
        resource_context = await self._collect_resource_context(manifest, resources)
        if resource_context:
            instruction = f"{instruction}\n\n{resource_context}"
        model_tools = self._model_tools_for_manifest(manifest, resources)
        messages = [
            ModelMessage(
                role=message.role,
                content=message.content,
                tool_calls=message.tool_calls,
                tool_call_id=message.tool_call_id,
            )
            for message in self._client.store.get_messages(self.session_id)
        ]
        tool_results: list[ToolResult] = []
        result = await self._generate_text(
            manifest=manifest,
            instruction=instruction,
            prompt=prompt,
            state=state,
            messages=messages,
            tools=model_tools,
            tool_results=tool_results,
        )
        for _round in range(4):
            if not result.tool_calls:
                break
            _append_model_response_messages(messages, result)
            tool_results = [
                ToolResult(
                    tool_call_id=call.id,
                    name=call.name,
                    output=await self._execute_model_tool_call(manifest, call, state),
                )
                for call in result.tool_calls
            ]
            messages.extend(
                ModelMessage(
                    role="tool",
                    content=_tool_result_content(tool_result.output),
                    tool_call_id=tool_result.tool_call_id,
                )
                for tool_result in tool_results
            )
            result = await self._generate_text(
                manifest=manifest,
                instruction=instruction,
                prompt=prompt,
                state=state,
                messages=messages,
                tools=model_tools,
                tool_results=tool_results,
            )
        output = result.output if isinstance(result, GenerateTextResult) else result
        if manifest.output_schema and isinstance(output, str):
            try:
                return json.loads(output)
            except json.JSONDecodeError:
                return output
        return output

    async def _generate_text(
        self,
        *,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
        messages: list[ModelMessage],
        tools: list[ModelTool],
        tool_results: list[ToolResult],
    ) -> GenerateTextResult:
        started_at = time.time()
        try:
            result = await self._client.model_provider.generate_text(
                manifest=manifest,
                instruction=instruction,
                prompt=prompt,
                state=state,
                messages=messages,
                tools=tools,
                tool_results=tool_results,
            )
        except Exception as exc:
            self._record_span(
                name=manifest.id,
                kind="model",
                started_at=started_at,
                ended_at=time.time(),
                status="error",
                error=str(exc),
                attributes={
                    "agentId": manifest.id,
                    "provider": manifest.model.provider,
                    "model": manifest.model.name,
                },
            )
            raise
        attributes: dict[str, Any] = {
            "agentId": manifest.id,
            "provider": manifest.model.provider,
            "model": result.model or manifest.model.name,
            "toolCallCount": len(result.tool_calls),
        }
        if result.usage:
            attributes["usage"] = result.usage
        self._record_span(
            name=manifest.id,
            kind="model",
            started_at=started_at,
            ended_at=time.time(),
            status="ok",
            attributes=attributes,
        )
        return result

    def _model_tools_for_manifest(
        self,
        manifest: LLMAgentManifest,
        resources: list[ResolvedResource] | None = None,
    ) -> list[ModelTool]:
        tools: list[ModelTool] = []
        seen_tool_names: set[str] = set()
        for entry in manifest.tools or []:
            kind = entry.get("kind")
            if kind == "local":
                for name in entry.get("tools", []):
                    definition = self._client.tools.get(str(name))
                    if definition is None:
                        raise RuntimeError(f"Local tool '{name}' was not registered")
                    if definition.name in seen_tool_names:
                        raise RuntimeError(f"Tool '{definition.name}' is registered more than once")
                    seen_tool_names.add(definition.name)
                    tools.append(
                        ModelTool(
                            name=definition.name,
                            description=definition.description,
                            input_schema=_schema_for_tool_definition(definition),
                        )
                    )
            elif kind == "http":
                tool_name = str(entry["name"])
                if tool_name in seen_tool_names:
                    raise RuntimeError(f"Tool '{tool_name}' is registered more than once")
                seen_tool_names.add(tool_name)
                tools.append(
                    ModelTool(
                        name=tool_name,
                        description=str(entry.get("description") or entry["name"]),
                        input_schema=_schema_from_params(entry.get("params")),
                    )
                )
            elif kind == "mcp":
                for item in entry.get("tools", []) or []:
                    name = item if isinstance(item, str) else item.get("tool")
                    if name:
                        tool_name = str(name)
                        if tool_name in seen_tool_names:
                            raise RuntimeError(f"Tool '{tool_name}' is registered more than once")
                        seen_tool_names.add(tool_name)
                        tools.append(
                            ModelTool(
                                name=tool_name,
                                description=tool_name,
                                input_schema=_schema_from_params(
                                    item.get("params") if isinstance(item, dict) else None
                                ),
                            )
                        )
            elif kind == "agent":
                agent_id = str(entry["agent"])
                try:
                    agent, _stored, _version = self._client._resolve_manifest(agent_id)
                except Exception:
                    agent = None
                if agent_id in seen_tool_names:
                    raise RuntimeError(f"Tool '{agent_id}' is registered more than once")
                seen_tool_names.add(agent_id)
                tools.append(
                    ModelTool(
                        name=agent_id,
                        description=(agent.description if agent else None) or agent_id,
                        input_schema=_json_schema_from_manifest_input(agent),
                    )
                )
        for _resource, provider_tool, tool_name in self._resource_provider_tools(
            manifest,
            resources,
        ):
            if tool_name in seen_tool_names or tool_name in self._client.tools:
                raise RuntimeError(
                    f"Resource tool '{tool_name}' conflicts with an existing tool. "
                    "Rename the resource or tool."
                )
            seen_tool_names.add(tool_name)
            tools.append(
                ModelTool(
                    name=tool_name,
                    description=provider_tool.description,
                    input_schema=_schema_for_input_schema(provider_tool.input_schema),
                )
            )
        return tools

    async def _execute_model_tool_call(
        self,
        manifest: LLMAgentManifest,
        call: ToolCall,
        state: AgentState,
    ) -> Any:
        started_at = time.time()
        try:
            result = await self._execute_model_tool_call_inner(manifest, call, state)
        except Exception as exc:
            self._record_span(
                name=call.name,
                kind="tool",
                started_at=started_at,
                ended_at=time.time(),
                status="error",
                error=str(exc),
                attributes={"agentId": manifest.id, "toolCallId": call.id},
            )
            raise
        self._record_span(
            name=call.name,
            kind="tool",
            started_at=started_at,
            ended_at=time.time(),
            status="ok",
            attributes={"agentId": manifest.id, "toolCallId": call.id},
        )
        return result

    async def _execute_model_tool_call_inner(
        self,
        manifest: LLMAgentManifest,
        call: ToolCall,
        state: AgentState,
    ) -> Any:
        for entry in manifest.tools or []:
            kind = entry.get("kind")
            if kind == "local" and call.name in entry.get("tools", []):
                definition = self._client.tools.get(call.name)
                if definition is None:
                    raise RuntimeError(f"Local tool '{call.name}' was not registered")
                return await definition.run(call.input)
            if kind == "http" and call.name == entry.get("name"):
                config = ToolCallConfig(
                    kind="http",
                    name=call.name,
                    params=call.input,
                    url=entry.get("url"),
                    method=entry.get("method"),
                    description=entry.get("description"),
                    headers=entry.get("headers"),
                    body_type=entry.get("body_type"),
                    body=entry.get("body"),
                    auth=entry.get("auth"),
                )
                return await invoke_http_tool(
                    config,
                    {**state, **call.input},
                    http_client=self._client.http_client,
                )
            if kind == "mcp" and _mcp_entry_has_tool(entry, call.name):
                config = ToolCallConfig(
                    kind="mcp",
                    name=call.name,
                    params=call.input,
                    server=entry.get("server"),
                )
                return await invoke_mcp_tool(
                    config,
                    {**state, **call.input},
                    http_client=self._client.http_client,
                )
            if kind == "agent" and call.name == entry.get("agent"):
                child = await self.resolve_agent(call.name)
                parent_modes = self._resource_modes_by_kind(
                    self._resolved_resources_for_manifest(manifest)
                )
                with self._resource_parent_modes(parent_modes):
                    result = await execute(child, call.input, self)
                return result.output
        resource_call = self._resolve_resource_tool_call(manifest, call.name)
        if resource_call is not None:
            resource, provider_tool = resource_call
            return await provider_tool.run(
                call.input,
                self._make_resource_tool_context(resource, manifest),
            )
        raise RuntimeError(f"Model requested unknown tool '{call.name}'")

    async def invoke_tool(self, config: ToolCallConfig, state: AgentState) -> Any:
        started_at = time.time()
        try:
            result = await self._invoke_tool(config, state)
        except Exception as exc:
            self._record_span(
                name=config.name,
                kind="tool",
                started_at=started_at,
                ended_at=time.time(),
                status="error",
                error=str(exc),
                attributes={"agentId": self.agent_id, "toolKind": config.kind},
            )
            raise
        self._record_span(
            name=config.name,
            kind="tool",
            started_at=started_at,
            ended_at=time.time(),
            status="ok",
            attributes={"agentId": self.agent_id, "toolKind": config.kind},
        )
        return result

    async def _invoke_tool(self, config: ToolCallConfig, state: AgentState) -> Any:
        if config.kind == "http":
            return await invoke_http_tool(config, state, http_client=self._client.http_client)
        if config.kind == "mcp":
            return await invoke_mcp_tool(config, state, http_client=self._client.http_client)
        if config.kind != "local":
            raise RuntimeError(f"Embedded Python SDK does not support {config.kind} tools yet")
        definition = self._client.tools.get(config.name)
        if definition is None:
            raise RuntimeError(f"Local tool '{config.name}' was not registered")
        params = dict(config.params or {})
        return await definition.run(params)

    def _record_span(
        self,
        *,
        name: str,
        kind: str,
        started_at: float,
        ended_at: float,
        status: str,
        attributes: dict[str, Any],
        error: str | None = None,
    ) -> None:
        self._client.store.put_trace_span(
            LocalTraceSpanRecord(
                span_id=f"span_{nanoid()}",
                trace_id=self.trace_id,
                parent_id=self.trace_id,
                run_id=self.run_id,
                session_id=self.session_id,
                name=name,
                kind=kind,
                started_at=started_at,
                ended_at=ended_at,
                status=status,
                error=error,
                attributes=attributes,
            )
        )

    async def resolve_agent(self, agent_id: str) -> AgentManifest:
        try:
            manifest, _agent, _version = self._client._resolve_manifest(agent_id)
            return manifest
        except KeyError as exc:
            raise RuntimeError(f"Unknown agent '{agent_id}'") from exc

    def _resolved_resources_for_manifest(
        self,
        manifest: LLMAgentManifest,
    ) -> list[ResolvedResource]:
        if not manifest.resources:
            return []
        parent_modes = (
            self._parent_resource_modes_stack[-1] if self._parent_resource_modes_stack else None
        )
        resolved: list[ResolvedResource] = []
        for name, definition in manifest.resources.items():
            kind = definition.kind or name
            provider = self._client.resource_providers.get(kind)
            if provider is None:
                raise RuntimeError(
                    f"Agent '{manifest.id}' declares resource '{name}' of kind '{kind}' "
                    "but no ResourceProvider is wired for that kind."
                )
            default_mode = getattr(provider, "default_mode", "read")
            declared_mode = cast(ResourceMode, definition.mode or default_mode or "read")
            parent_mode = parent_modes.get(kind) if parent_modes else None
            mode = clamp_resource_mode(declared_mode, parent_mode)
            resolved.append(
                ResolvedResource(
                    name=name,
                    definition=definition,
                    provider=provider,
                    mode=mode,
                )
            )
        return resolved

    async def _collect_resource_context(
        self,
        manifest: LLMAgentManifest,
        resources: list[ResolvedResource],
    ) -> str | None:
        parts: list[str] = []
        for resource in resources:
            get_context = getattr(resource.provider, "get_context", None)
            if not callable(get_context):
                continue
            result = get_context(self._make_resource_tool_context(resource, manifest))
            if inspect.isawaitable(result):
                result = await result
            if isinstance(result, str) and result.strip():
                parts.append(f"## Resource: {resource.name}\n{result}")
        return "\n\n".join(parts) if parts else None

    def _resource_provider_tools(
        self,
        manifest: LLMAgentManifest,
        resources: list[ResolvedResource] | None = None,
    ) -> list[tuple[ResolvedResource, ResourceProviderToolDefinition, str]]:
        resolved = (
            resources if resources is not None else self._resolved_resources_for_manifest(manifest)
        )
        output: list[tuple[ResolvedResource, ResourceProviderToolDefinition, str]] = []
        for resource in resolved:
            tools = getattr(resource.provider, "tools", None)
            if not callable(tools):
                continue
            registration = ResourceRegistrationContext(
                resource_name=resource.name,
                kind=resource.definition.kind or resource.name,
                mode=resource.mode,
                config=resource.definition,
            )
            provider_tools = cast(Iterable[ResourceProviderToolDefinition], tools(registration))
            for provider_tool in provider_tools:
                if resource.mode == "read" and provider_tool.mode == "read-write":
                    continue
                output.append(
                    (
                        resource,
                        provider_tool,
                        make_resource_tool_name(resource.name, provider_tool.name),
                    )
                )
        return output

    def _resolve_resource_tool_call(
        self,
        manifest: LLMAgentManifest,
        tool_name: str,
    ) -> tuple[ResolvedResource, ResourceProviderToolDefinition] | None:
        for resource, provider_tool, candidate in self._resource_provider_tools(manifest):
            if candidate == tool_name:
                return resource, provider_tool
        return None

    def _make_resource_tool_context(
        self,
        resource: ResolvedResource,
        manifest: LLMAgentManifest,
    ) -> ResourceToolContext:
        return ResourceToolContext(
            resource_name=resource.name,
            kind=resource.definition.kind or resource.name,
            mode=resource.mode,
            config=resource.definition,
            grants=list(self.context),
            run={
                "agentId": manifest.id,
                "sessionId": self.session_id,
                "runId": self.run_id,
                "invocationId": self.invocation_id,
            },
        )

    def _resource_modes_by_kind(
        self,
        resources: list[ResolvedResource],
    ) -> dict[str, ResourceMode]:
        modes: dict[str, ResourceMode] = {}
        for resource in resources:
            kind = resource.definition.kind or resource.name
            existing = modes.get(kind)
            modes[kind] = (
                clamp_resource_mode(existing, resource.mode) if existing else resource.mode
            )
        return modes

    @contextmanager
    def _resource_parent_modes(self, modes: dict[str, ResourceMode]) -> Iterator[None]:
        self._parent_resource_modes_stack.append(modes)
        try:
            yield
        finally:
            self._parent_resource_modes_stack.pop()


def agntz(
    *,
    agents: str,
    tools: Iterable[ToolDefinition] | None = None,
    resources: Mapping[str, ResourceProvider] | None = None,
    namespace_policy: NamespaceGrantPolicyLike = None,
    model_provider: ModelProvider | None = None,
    store: RunStore | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> LocalClient:
    loaded = _load_manifests_with_sources(agents)
    manifests = {agent_id: manifest for agent_id, (manifest, _source) in loaded.items()}
    resolved_store = store or MemoryStore()
    _import_manifests_into_store(resolved_store, loaded)
    tool_map = {definition.name: definition for definition in tools or []}
    return LocalClient(
        manifests=manifests,
        tools=tool_map,
        resources=resources,
        namespace_policy=namespace_policy,
        model_provider=model_provider,
        store=resolved_store,
        http_client=http_client,
    )


def _load_manifests_with_sources(path: str | Path) -> dict[str, tuple[AgentManifest, str]]:
    root = Path(path)
    output: dict[str, tuple[AgentManifest, str]] = {}
    for manifest_path in sorted(
        candidate
        for candidate in root.rglob("*")
        if candidate.suffix.lower() in {".yaml", ".yml"}
    ):
        source = manifest_path.read_text(encoding="utf-8")
        manifest = load_manifest_file(manifest_path)
        if manifest.id in output:
            raise ValueError(f"Duplicate agent id '{manifest.id}' in {manifest_path}")
        output[manifest.id] = (manifest, source)
    return output


def _import_manifests_into_store(
    store: Any,
    loaded: dict[str, tuple[AgentManifest, str]],
) -> None:
    for manifest, source in loaded.values():
        content_hash = hashlib.sha256(source.encode()).hexdigest()
        agent = _agent_definition_from_manifest(manifest, source)
        put_if_changed = getattr(store, "put_agent_if_changed", None)
        if callable(put_if_changed):
            put_if_changed(agent, content_hash=content_hash)
            continue
        put_agent = getattr(store, "put_agent", None)
        if callable(put_agent):
            metadata = dict(agent.metadata or {})
            metadata["contentHash"] = content_hash
            put_agent(agent.model_copy(update={"metadata": metadata}))


def _agent_definition_from_manifest(
    manifest: AgentManifest,
    source: str | None,
) -> StoredAgentDefinition:
    model = getattr(manifest, "model", None)
    provider = getattr(model, "provider", "openai")
    name = getattr(model, "name", "gpt-5.4")
    metadata: dict[str, Any] = {"kind": manifest.kind}
    if source is not None:
        metadata["manifest"] = source
    return StoredAgentDefinition(
        id=manifest.id,
        name=manifest.name or manifest.id,
        description=manifest.description,
        systemPrompt=getattr(manifest, "instruction", "") or "",
        model=StoredModelConfig(provider=provider, name=name),
        outputSchema=getattr(manifest, "output_schema", None),
        metadata=metadata,
    )


def _merge_payload(value: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    if value is None:
        payload: dict[str, Any] = {}
    elif hasattr(value, "model_dump"):
        payload = value.model_dump(by_alias=True, exclude_none=True)
    elif isinstance(value, dict):
        payload = dict(value)
    else:
        raise TypeError("Expected a Pydantic model, dict, or keyword arguments")
    for key, item in kwargs.items():
        payload[_snake_to_camel(key)] = item
    return payload


def _agent_from_payload(payload: dict[str, Any]) -> StoredAgentDefinition:
    manifest_source = payload.get("manifest")
    if isinstance(manifest_source, str):
        manifest = parse_manifest(manifest_source)
        agent = _agent_definition_from_manifest(manifest, manifest_source)
        extra_metadata = {
            key: value
            for key, value in payload.items()
            if key not in {"id", "name", "manifest"}
        }
        metadata = dict(agent.metadata or {})
        metadata.update(extra_metadata)
        return agent.model_copy(
            update={
                "id": payload.get("id") or manifest.id,
                "name": payload.get("name") or manifest.name or manifest.id,
                "metadata": metadata,
            }
        )
    if "id" not in payload:
        raise ValueError("Missing required field: id")
    if "name" not in payload:
        payload["name"] = payload["id"]
    return StoredAgentDefinition.model_validate(payload)


def _dataset_from_payload(payload: dict[str, Any]) -> EvalDataset:
    if "id" not in payload:
        payload["id"] = f"dataset_{nanoid()}"
    if "agentId" not in payload:
        raise ValueError("Missing required field: agent_id")
    if "name" not in payload:
        payload["name"] = payload["id"]
    payload["items"] = [
        {
            **item,
            "id": item.get("id") or f"case_{str(index + 1).zfill(3)}",
        }
        for index, item in enumerate(payload.get("items") or [])
        if isinstance(item, dict)
    ]
    return EvalDataset.model_validate(payload)


def _eval_from_payload(payload: dict[str, Any]) -> EvalDefinition:
    if "id" not in payload:
        payload["id"] = f"eval_{nanoid()}"
    if "agentId" not in payload:
        raise ValueError("Missing required field: agent_id")
    if "name" not in payload:
        payload["name"] = payload["id"]
    payload["criteria"] = [
        {
            **criterion,
            "id": criterion.get("id") or f"criterion_{str(index + 1).zfill(2)}",
            "name": criterion.get("name") or f"Criterion {index + 1}",
        }
        for index, criterion in enumerate(payload.get("criteria") or [])
        if isinstance(criterion, dict)
    ]
    return EvalDefinition.model_validate(payload)


def _assert_eval_dataset_scope(store: Any, definition: EvalDefinition) -> None:
    if not definition.default_dataset_id:
        return
    dataset = store.get_dataset(definition.default_dataset_id)
    if dataset is None:
        raise KeyError(definition.default_dataset_id)
    if dataset.agent_id != definition.agent_id:
        raise ValueError(
            f'Dataset "{dataset.id}" belongs to agent "{dataset.agent_id}", '
            f'not "{definition.agent_id}"'
        )


def _snake_to_camel(value: str) -> str:
    if "_" not in value:
        return value
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def _iso_now_z() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _run_blocking(awaitable: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)
    raise RuntimeError("Use await client.agents.arun(...) when already inside an event loop")


def _iso_now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _duration_ms(started_at: float, ended_at: float | None) -> int | None:
    if ended_at is None:
        return None
    return int((ended_at - started_at) * 1000)


def _message_content(value: Any) -> str | list[dict[str, Any]]:
    if isinstance(value, str):
        return value
    blocks = _content_blocks(value)
    if blocks is not None:
        return blocks
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _append_model_response_messages(
    messages: list[ModelMessage],
    result: GenerateTextResult,
) -> None:
    if result.response_messages:
        messages.extend(result.response_messages)
        return
    messages.append(
        ModelMessage(
            role="assistant",
            content=result.text or "",
            tool_calls=[_tool_call_message(call) for call in result.tool_calls] or None,
        )
    )


def _tool_call_message(call: ToolCall) -> dict[str, Any]:
    return {
        "id": call.id,
        "type": "function",
        "function": {
            "name": call.name,
            "arguments": json.dumps(call.input, separators=(",", ":"), sort_keys=True),
        },
    }


def _tool_result_content(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str, separators=(",", ":"), sort_keys=True)


def _content_blocks(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list) or not value:
        return None
    blocks: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            return None
        kind = item.get("type")
        if kind == "text" and isinstance(item.get("text"), str):
            blocks.append(dict(item))
            continue
        if kind == "image" and (
            isinstance(item.get("url"), str) or isinstance(item.get("base64"), str)
        ):
            blocks.append(dict(item))
            continue
        return None
    return blocks


def _schema_for_tool_definition(definition: ToolDefinition) -> dict[str, Any]:
    return _schema_for_input_schema(definition.input_schema)


def _schema_for_input_schema(
    schema: type[BaseModel] | dict[str, Any] | None,
) -> dict[str, Any]:
    if isinstance(schema, dict):
        return schema
    if schema is not None and hasattr(schema, "model_json_schema"):
        return schema.model_json_schema()
    return {"type": "object", "properties": {}}


def _schema_from_params(params: Any) -> dict[str, Any]:
    if not isinstance(params, dict):
        return {"type": "object", "properties": {}}
    return {
        "type": "object",
        "properties": {key: {"type": "string"} for key in params},
        "required": list(params),
    }


def _json_schema_from_manifest_input(manifest: AgentManifest | None) -> dict[str, Any]:
    if manifest is None or not manifest.input_schema:
        return {"type": "object", "properties": {}}
    return {
        "type": "object",
        "properties": {
            key: {"type": value} if isinstance(value, str) else value
            for key, value in manifest.input_schema.items()
        },
        "required": list(manifest.input_schema),
    }


def _mcp_entry_has_tool(entry: dict[str, Any], name: str) -> bool:
    return any(
        item == name or (isinstance(item, dict) and item.get("tool") == name)
        for item in entry.get("tools", []) or []
    )
