"""Embedded local SDK entrypoint."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime
from typing import Any

import httpx

from agntz.client.models import Event, RunResult
from agntz.core import (
    GenerateTextResult,
    MissingModelProvider,
    ModelMessage,
    ModelProvider,
    ModelTool,
    ToolCall,
    ToolDefinition,
    ToolResult,
    invoke_http_tool,
    invoke_mcp_tool,
)
from agntz.core.ids import run_id as new_run_id
from agntz.core.ids import session_id as new_session_id
from agntz.core.ids import trace_id as new_trace_id
from agntz.manifest import execute, load_manifests_from_dir
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
        store: RunStore | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.manifests = manifests
        self.tools = tools
        self.model_provider = model_provider or MissingModelProvider()
        self.store = store or MemoryStore()
        self.http_client = http_client
        self.agents = LocalAgentsResource(self)
        self.runs = LocalRunsResource(self)
        self.sessions = LocalSessionsResource(self)
        self.traces = LocalTracesResource(self)

    async def _execute(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
    ) -> RunResult:
        manifest = self.manifests[agent_id]
        resolved_session_id = session_id or new_session_id()
        local_run_id = new_run_id()
        local_trace_id = new_trace_id()
        started_at = time.time()
        ctx = _LocalExecutionContext(
            self,
            agent_id=agent_id,
            session_id=resolved_session_id,
            run_id=local_run_id,
            trace_id=local_trace_id,
        )
        self.store.append_messages(
            resolved_session_id,
            [
                LocalMessageRecord(
                    session_id=resolved_session_id,
                    agent_id=agent_id,
                    role="user",
                    content=_message_content(input),
                    timestamp=_iso_now(),
                )
            ],
            agent_id=agent_id,
        )
        self.store.put_run(
            LocalRunRecord(
                id=local_run_id,
                root_id=local_run_id,
                agent_id=agent_id,
                session_id=resolved_session_id,
                status="running",
                input=input,
            )
        )
        self.store.put_trace(
            LocalTraceRecord(
                trace_id=local_trace_id,
                run_id=local_run_id,
                agent_id=agent_id,
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
                    agent_id=agent_id,
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
                    agent_id=agent_id,
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
                agent_id=agent_id,
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
                    agent_id=agent_id,
                    role="assistant",
                    content=_message_content(result.output),
                    timestamp=_iso_now(),
                )
            ],
            agent_id=agent_id,
        )
        self.store.put_trace(
            LocalTraceRecord(
                trace_id=local_trace_id,
                run_id=local_run_id,
                agent_id=agent_id,
                session_id=resolved_session_id,
                status="ok",
                started_at=started_at,
                ended_at=time.time(),
                output=result.output,
            )
        )
        return RunResult(output=result.output, state=result.state, sessionId=resolved_session_id)


class LocalAgentsResource:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    def run(self, *, agent_id: str, input: Any = None, session_id: str | None = None) -> RunResult:
        return _run_blocking(
            self._client._execute(agent_id=agent_id, input=input, session_id=session_id)
        )

    async def arun(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
    ) -> RunResult:
        return await self._client._execute(agent_id=agent_id, input=input, session_id=session_id)

    def stream(
        self,
        *,
        agent_id: str,
        input: Any = None,
        session_id: str | None = None,
    ) -> Iterator[Event]:
        resolved_session_id = session_id or new_session_id()
        manifest = self._client.manifests[agent_id]
        yield Event(
            type="start",
            agentId=agent_id,
            kind=manifest.kind,
            sessionId=resolved_session_id,
        )
        result = self.run(agent_id=agent_id, input=input, session_id=resolved_session_id)
        yield Event(
            type="complete",
            output=result.output,
            state=result.state,
            sessionId=result.session_id,
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
                trace.summary()
                for trace in self._client.store.list_traces(agent_id=agent_id, status=status)
            ]
        }

    def get(self, trace_id: str) -> dict[str, Any] | None:
        trace = self._client.store.get_trace(trace_id)
        if trace is None:
            return None
        return {"summary": trace.summary(), "spans": [_trace_span(trace)]}

    def stream(self, trace_id: str) -> Iterator[Event]:
        detail = self.get(trace_id)
        if detail is not None:
            yield Event(type="snapshot", summary=detail["summary"], spans=detail["spans"])


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
        "durationMs": trace.summary()["durationMs"],
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
    ) -> None:
        self._client = client
        self.agent_id = agent_id
        self.session_id = session_id
        self.run_id = run_id
        self.trace_id = trace_id

    async def invoke_llm(
        self,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> Any:
        model_tools = self._model_tools_for_manifest(manifest)
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
        result = await self._client.model_provider.generate_text(
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
            tool_results = [
                ToolResult(
                    tool_call_id=call.id,
                    name=call.name,
                    output=await self._execute_model_tool_call(manifest, call, state),
                )
                for call in result.tool_calls
            ]
            result = await self._client.model_provider.generate_text(
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

    def _model_tools_for_manifest(self, manifest: LLMAgentManifest) -> list[ModelTool]:
        tools: list[ModelTool] = []
        for entry in manifest.tools or []:
            kind = entry.get("kind")
            if kind == "local":
                for name in entry.get("tools", []):
                    definition = self._client.tools.get(str(name))
                    if definition is None:
                        raise RuntimeError(f"Local tool '{name}' was not registered")
                    tools.append(
                        ModelTool(
                            name=definition.name,
                            description=definition.description,
                            input_schema=_schema_for_tool_definition(definition),
                        )
                    )
            elif kind == "http":
                tools.append(
                    ModelTool(
                        name=str(entry["name"]),
                        description=str(entry.get("description") or entry["name"]),
                        input_schema=_schema_from_params(entry.get("params")),
                    )
                )
            elif kind == "mcp":
                for item in entry.get("tools", []) or []:
                    name = item if isinstance(item, str) else item.get("tool")
                    if name:
                        tools.append(
                            ModelTool(
                                name=str(name),
                                description=str(name),
                                input_schema=_schema_from_params(
                                    item.get("params") if isinstance(item, dict) else None
                                ),
                            )
                        )
            elif kind == "agent":
                agent_id = str(entry["agent"])
                agent = self._client.manifests.get(agent_id)
                tools.append(
                    ModelTool(
                        name=agent_id,
                        description=(agent.description if agent else None) or agent_id,
                        input_schema=_json_schema_from_manifest_input(agent),
                    )
                )
        return tools

    async def _execute_model_tool_call(
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
                result = await execute(child, call.input, self)
                return result.output
        raise RuntimeError(f"Model requested unknown tool '{call.name}'")

    async def invoke_tool(self, config: ToolCallConfig, state: AgentState) -> Any:
        if config.kind == "http":
            return await invoke_http_tool(config, state, http_client=self._client.http_client)
        if config.kind == "mcp":
            return await invoke_mcp_tool(config, state, http_client=self._client.http_client)
        if config.kind != "local":
            raise RuntimeError(
                f"Embedded Python SDK does not support {config.kind} tools yet"
            )
        definition = self._client.tools.get(config.name)
        if definition is None:
            raise RuntimeError(f"Local tool '{config.name}' was not registered")
        params = dict(config.params or {})
        return await definition.run(params)

    async def resolve_agent(self, agent_id: str) -> AgentManifest:
        try:
            return self._client.manifests[agent_id]
        except KeyError as exc:
            raise RuntimeError(f"Unknown agent '{agent_id}'") from exc


def agntz(
    *,
    agents: str,
    tools: Iterable[ToolDefinition] | None = None,
    model_provider: ModelProvider | None = None,
    store: RunStore | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> LocalClient:
    manifests = load_manifests_from_dir(agents)
    tool_map = {definition.name: definition for definition in tools or []}
    return LocalClient(
        manifests=manifests,
        tools=tool_map,
        model_provider=model_provider,
        store=store,
        http_client=http_client,
    )


def _run_blocking(awaitable: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)
    raise RuntimeError("Use await client.agents.arun(...) when already inside an event loop")


def _iso_now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _message_content(value: Any) -> str | list[dict[str, Any]]:
    if isinstance(value, str):
        return value
    blocks = _content_blocks(value)
    if blocks is not None:
        return blocks
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


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
    schema = definition.input_schema
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
