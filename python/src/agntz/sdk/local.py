"""Embedded local SDK entrypoint."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterable, Iterator
from typing import Any

import httpx

from agntz.client.models import Event, RunResult
from agntz.core import (
    GenerateTextResult,
    MissingModelProvider,
    ModelProvider,
    ToolDefinition,
    invoke_http_tool,
)
from agntz.core.ids import run_id as new_run_id
from agntz.core.ids import session_id as new_session_id
from agntz.manifest import execute, load_manifests_from_dir
from agntz.manifest.types import (
    AgentManifest,
    AgentState,
    LLMAgentManifest,
    ToolCallConfig,
)
from agntz.stores import LocalRunRecord, MemoryStore


class LocalClient:
    def __init__(
        self,
        *,
        manifests: dict[str, AgentManifest],
        tools: dict[str, ToolDefinition],
        model_provider: ModelProvider | None,
        store: MemoryStore | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.manifests = manifests
        self.tools = tools
        self.model_provider = model_provider or MissingModelProvider()
        self.store = store or MemoryStore()
        self.http_client = http_client
        self.agents = LocalAgentsResource(self)
        self.runs = LocalRunsResource(self)
        self.traces = LocalTracesResource()

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
        ctx = _LocalExecutionContext(self)
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


class LocalTracesResource:
    def list(self) -> dict[str, list[Any]]:
        return {"rows": []}

    def get(self, trace_id: str) -> None:
        return None


class _LocalExecutionContext:
    def __init__(self, client: LocalClient) -> None:
        self._client = client

    async def invoke_llm(
        self,
        manifest: LLMAgentManifest,
        instruction: str,
        prompt: str | None,
        state: AgentState,
    ) -> Any:
        result = await self._client.model_provider.generate_text(
            manifest=manifest,
            instruction=instruction,
            prompt=prompt,
            state=state,
        )
        output = result.output if isinstance(result, GenerateTextResult) else result
        if manifest.output_schema and isinstance(output, str):
            try:
                return json.loads(output)
            except json.JSONDecodeError:
                return output
        return output

    async def invoke_tool(self, config: ToolCallConfig, state: AgentState) -> Any:
        if config.kind == "http":
            return await invoke_http_tool(config, state, http_client=self._client.http_client)
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
    store: MemoryStore | None = None,
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
