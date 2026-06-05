"""ASGI app factory for hosted Python Agntz deployments."""
# pyright: reportMissingImports=false

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import Any, NoReturn

from agntz.client.models import (
    EvalDefinition,
    EvalRun,
    EvalRunSnapshots,
)
from agntz.core import ModelProvider, ResourceProvider, ToolDefinition
from agntz.core.ids import nanoid
from agntz.core.ids import session_id as new_session_id
from agntz.evals import (
    TargetInvocation,
    build_judge_prompt,
    create_eval_judge_agent,
    execute_eval_run,
)
from agntz.evals import (
    cancel_eval_run as cancel_stored_eval_run,
)
from agntz.sdk.local import (
    LocalClient,
    _agent_from_payload,
    _dataset_from_payload,
    _eval_from_payload,
    _manifest_from_stored_agent,
)
from agntz.stores import MemoryStore, RunStore
from agntz.stores.memory import LocalRunRecord


def create_app(
    *,
    store: Any | None = None,
    internal_secret: str,
    model_provider: ModelProvider | None = None,
    tools: list[ToolDefinition] | None = None,
    resources: Mapping[str, ResourceProvider] | None = None,
) -> Any:
    """Create a FastAPI ASGI app backed by a synchronous Agntz store."""

    try:
        from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
        from fastapi.responses import JSONResponse, StreamingResponse
    except ImportError as exc:  # pragma: no cover - only hit without server extra.
        raise RuntimeError(
            "agntz.server requires the `server` extra: pip install 'agntz[server]'"
        ) from exc
    globals()["BackgroundTasks"] = BackgroundTasks
    globals()["Request"] = Request

    backing_store = store or MemoryStore()
    app = FastAPI(title="Agntz Python Server")
    eval_cancelled: set[str] = set()

    async def user_id_from_auth(request: Request) -> str:
        internal = request.headers.get("x-internal-secret")
        if internal and internal == internal_secret:
            body = await _json_body(request)
            user_id = body.get("userId") or request.headers.get("x-user-id")
            if not isinstance(user_id, str) or not user_id:
                raise HTTPException(
                    status_code=400,
                    detail="internal request missing userId in body or X-User-Id header",
                )
            return user_id
        auth = request.headers.get("authorization")
        if auth and auth.startswith("Bearer "):
            raw_key = auth[len("Bearer ") :].strip()
            resolved = await _call(backing_store.resolve_api_key, raw_key)
            if resolved is None:
                raise HTTPException(status_code=401, detail="invalid or revoked API key")
            user_id = resolved.get("user_id") or resolved.get("userId")
            if isinstance(user_id, str):
                return user_id
        raise HTTPException(status_code=401, detail="missing authentication")

    def scoped(user_id: str) -> Any:
        for_user = getattr(backing_store, "for_user", None)
        if callable(for_user):
            return for_user(user_id)
        for_user = getattr(backing_store, "forUser", None)
        if callable(for_user):
            return for_user(user_id)
        return backing_store

    def local_client(user_id: str) -> LocalClient:
        return LocalClient(
            manifests={},
            tools={tool.name: tool for tool in tools or []},
            model_provider=model_provider,
            resources=resources,
            store=scoped(user_id),
        )

    def eval_http_error(exc: Exception) -> NoReturn:
        detail = str(exc)
        status = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status, detail=detail)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "agntz-python-server"}

    @app.post("/run")
    async def run(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        body = await _json_body(request)
        agent_id = body.get("agentId")
        if not isinstance(agent_id, str) or not agent_id:
            raise HTTPException(status_code=400, detail="Missing required field: agentId")
        client = local_client(user_id)
        try:
            result = await client._execute(
                agent_id=agent_id,
                input=body.get("input"),
                session_id=body.get("sessionId"),
                context=body.get("context"),
            )
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"Agent not found: {agent_id}") from exc
        return _dump(result)

    @app.post("/run/stream")
    async def run_stream(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        body = await _json_body(request)
        agent_id = body.get("agentId")
        if not isinstance(agent_id, str) or not agent_id:
            raise HTTPException(status_code=400, detail="Missing required field: agentId")

        async def events() -> AsyncIterator[str]:
            client = local_client(user_id)
            manifest, agent, _version = client._resolve_manifest(agent_id)
            session_id = body.get("sessionId") or new_session_id()
            yield _sse(
                "run-start",
                {"agentId": agent.id, "kind": manifest.kind, "sessionId": session_id},
            )
            try:
                result = await client._execute(
                    agent_id=agent_id,
                    input=body.get("input"),
                    session_id=session_id,
                    context=body.get("context"),
                )
                yield _sse("run-complete", _dump(result))
            except Exception as exc:
                yield _sse("run-error", {"error": str(exc)})

        return StreamingResponse(events(), media_type="text/event-stream")

    @app.post("/runs")
    async def start_run(
        request: Request,
        background: BackgroundTasks,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        body = await _json_body(request)
        agent_id = body.get("agentId")
        if not isinstance(agent_id, str) or not agent_id:
            raise HTTPException(status_code=400, detail="Missing required field: agentId")
        run_id = f"run_{nanoid()}"
        session_id = body.get("sessionId") or new_session_id()
        scoped_store = scoped(user_id)
        record = LocalRunRecord(
            id=run_id,
            root_id=run_id,
            agent_id=agent_id.split("@", 1)[0],
            session_id=session_id,
            status="running",
            input=body.get("input"),
        )
        await _call(scoped_store.put_run, record)
        background.add_task(
            _execute_background_run,
            local_client(user_id),
            scoped_store,
            run_id,
            agent_id,
            body.get("input"),
            session_id,
            body.get("context"),
        )
        return _run_record_json(record, user_id)

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        row = await _call(scoped(user_id).get_run, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return _run_record_json(row, user_id)

    @app.post("/runs/{run_id}/cancel")
    async def cancel_run(run_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        scoped_store = scoped(user_id)
        row = await _call(scoped_store.get_run, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Run not found")
        cancelled = LocalRunRecord(
            id=row.id,
            root_id=row.root_id,
            agent_id=row.agent_id,
            session_id=row.session_id,
            status="cancelled",
            input=row.input,
            output=row.output,
            error=row.error,
        )
        await _call(scoped_store.put_run, cancelled)
        return _run_record_json(cancelled, user_id)

    @app.get("/runs")
    async def list_runs(
        user_id: str = Depends(user_id_from_auth),
        agentId: str | None = None,
        status: str | None = None,
    ) -> Any:
        rows = await _call(scoped(user_id).list_runs, agent_id=agentId, status=status)
        return {"rows": [_run_record_json(row, user_id) for row in rows]}

    @app.get("/agents")
    async def list_agents(user_id: str = Depends(user_id_from_auth)) -> Any:
        return await _call(scoped(user_id).list_agents)

    @app.post("/agents")
    async def create_agent(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        agent = _agent_from_payload(await _json_body(request))
        row = await _call(scoped(user_id).put_agent, agent)
        return JSONResponse(_dump(row), status_code=201)

    @app.get("/agents/{agent_id}")
    async def get_agent(agent_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        row = await _call(scoped(user_id).get_agent, agent_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Agent not found")
        return _dump(row)

    @app.put("/agents/{agent_id}")
    async def update_agent(
        agent_id: str,
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        scoped_store = scoped(user_id)
        existing = await _call(scoped_store.get_agent, agent_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Agent not found")
        payload = existing.model_dump(by_alias=True, exclude_none=True)
        payload.update(await _json_body(request))
        payload["id"] = agent_id
        row = await _call(scoped_store.put_agent, _agent_from_payload(payload))
        return _dump(row)

    @app.delete("/agents/{agent_id}")
    async def delete_agent(agent_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        await _call(scoped(user_id).delete_agent, agent_id)
        return JSONResponse(status_code=204, content=None)

    @app.get("/agents/{agent_id}/versions")
    async def list_versions(agent_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        rows = await _call(scoped(user_id).list_agent_versions, agent_id)
        return [_dump(row) for row in rows]

    @app.get("/agents/{agent_id}/versions/{created_at}")
    async def get_version(
        agent_id: str,
        created_at: str,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        row = await _call(scoped(user_id).get_agent_version, agent_id, created_at)
        if row is None:
            raise HTTPException(status_code=404, detail="Agent version not found")
        return _dump(row)

    @app.post("/agents/{agent_id}/versions/{created_at}/activate")
    async def activate_version(
        agent_id: str,
        created_at: str,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        await _call(scoped(user_id).activate_agent_version, agent_id, created_at)
        return {"agentId": agent_id, "createdAt": created_at, "activated": True}

    @app.put("/agents/{agent_id}/aliases/{alias}")
    async def set_alias(
        agent_id: str,
        alias: str,
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        body = await _json_body(request)
        created_at = body.get("createdAt")
        if not isinstance(created_at, str):
            raise HTTPException(status_code=400, detail="Missing required field: createdAt")
        await _call(scoped(user_id).set_agent_version_alias, agent_id, created_at, alias)
        return {"agentId": agent_id, "alias": alias, "createdAt": created_at}

    @app.delete("/agents/{agent_id}/aliases/{alias}")
    async def remove_alias(
        agent_id: str,
        alias: str,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        await _call(scoped(user_id).remove_agent_version_alias, agent_id, alias)
        return {"agentId": agent_id, "alias": alias, "removed": True}

    @app.get("/datasets")
    async def list_datasets(
        user_id: str = Depends(user_id_from_auth),
        agentId: str | None = None,
    ) -> Any:
        rows = await _call(scoped(user_id).list_datasets, agent_id=agentId)
        return [_dump(row) for row in rows]

    @app.post("/datasets")
    async def create_dataset(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        row = await _call(
            scoped(user_id).put_dataset,
            _dataset_from_payload(await _json_body(request)),
        )
        return JSONResponse(_dump(row), status_code=201)

    @app.get("/datasets/{dataset_id}")
    async def get_dataset(dataset_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        row = await _call(scoped(user_id).get_dataset, dataset_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        return _dump(row)

    @app.put("/datasets/{dataset_id}")
    async def update_dataset(
        dataset_id: str,
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        scoped_store = scoped(user_id)
        existing = await _call(scoped_store.get_dataset, dataset_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        payload = existing.model_dump(by_alias=True, exclude_none=True)
        payload.update(await _json_body(request))
        payload["id"] = dataset_id
        row = await _call(scoped_store.put_dataset, _dataset_from_payload(payload))
        return _dump(row)

    @app.delete("/datasets/{dataset_id}")
    async def delete_dataset(dataset_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        await _call(scoped(user_id).delete_dataset, dataset_id)
        return JSONResponse(status_code=204, content=None)

    @app.get("/evals")
    async def list_evals(
        user_id: str = Depends(user_id_from_auth),
        agentId: str | None = None,
    ) -> Any:
        rows = await _call(scoped(user_id).list_evals, agent_id=agentId)
        return [_dump(row) for row in rows]

    @app.post("/evals")
    async def create_eval(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        try:
            definition = _eval_from_payload(await _json_body(request))
            await _assert_eval_dataset_scope(scoped(user_id), definition)
        except (KeyError, ValueError) as exc:
            eval_http_error(exc)
        row = await _call(scoped(user_id).put_eval, definition)
        return JSONResponse(_dump(row), status_code=201)

    @app.get("/evals/{eval_id}")
    async def get_eval(eval_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        row = await _call(scoped(user_id).get_eval, eval_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Eval not found")
        return _dump(row)

    @app.put("/evals/{eval_id}")
    async def update_eval(
        eval_id: str,
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        scoped_store = scoped(user_id)
        existing = await _call(scoped_store.get_eval, eval_id)
        if existing is None:
            raise HTTPException(status_code=404, detail="Eval not found")
        payload = existing.model_dump(by_alias=True, exclude_none=True)
        payload.update(await _json_body(request))
        payload["id"] = eval_id
        try:
            definition = _eval_from_payload(payload)
            await _assert_eval_dataset_scope(scoped_store, definition)
        except (KeyError, ValueError) as exc:
            eval_http_error(exc)
        row = await _call(scoped_store.put_eval, definition)
        return _dump(row)

    @app.delete("/evals/{eval_id}")
    async def delete_eval(eval_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        await _call(scoped(user_id).delete_eval, eval_id)
        return JSONResponse(status_code=204, content=None)

    @app.post("/eval-runs")
    async def start_eval_run(
        request: Request,
        background: BackgroundTasks,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        body = await _json_body(request)
        eval_id = body.get("evalId")
        if not isinstance(eval_id, str):
            raise HTTPException(status_code=400, detail="Missing required field: evalId")
        try:
            run = await _create_eval_run(
                scoped(user_id),
                local_client(user_id),
                eval_id=eval_id,
                dataset_id=body.get("datasetId"),
                agent_version=body.get("agentVersion"),
            )
        except (KeyError, ValueError) as exc:
            eval_http_error(exc)
        background.add_task(
            _execute_eval_run,
            scoped(user_id),
            local_client(user_id),
            run.id,
            eval_cancelled,
        )
        return JSONResponse(_dump(run), status_code=201)

    @app.get("/eval-runs/{run_id}")
    async def get_eval_run(run_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        row = await _call(scoped(user_id).get_eval_run, run_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Eval run not found")
        return _dump(row)

    @app.get("/eval-runs")
    async def list_eval_runs(
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        params = dict(request.query_params)
        rows = await _call(scoped(user_id).list_eval_runs, **_filter_params(params))
        return _dump(rows)

    @app.post("/eval-runs/{run_id}/cancel")
    async def cancel_eval_run(run_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        eval_cancelled.add(run_id)
        scoped_store = scoped(user_id)
        run = await _call(scoped_store.get_eval_run, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Eval run not found")
        return _dump(await _call(cancel_stored_eval_run, scoped_store, run))

    @app.get("/eval-scores")
    async def list_scores(
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        params = dict(request.query_params)
        rows = await _call(scoped(user_id).list_eval_latest_scores, **_filter_params(params))
        return [_dump(row) for row in rows]

    @app.get("/eval-scores/latest")
    async def latest_score(
        user_id: str = Depends(user_id_from_auth),
        evalId: str | None = None,
        datasetId: str | None = None,
        resolvedAgentVersion: str | None = None,
    ) -> Any:
        if not evalId or not datasetId:
            raise HTTPException(
                status_code=400,
                detail="Missing required query params: evalId, datasetId",
            )
        row = await _call(
            scoped(user_id).get_eval_latest_score,
            eval_id=evalId,
            dataset_id=datasetId,
            resolved_agent_version=resolvedAgentVersion,
        )
        return _dump(row) if row is not None else None

    @app.get("/traces")
    async def list_traces(
        user_id: str = Depends(user_id_from_auth),
        agentId: str | None = None,
        status: str | None = None,
    ) -> Any:
        traces = await _call(scoped(user_id).list_traces, agent_id=agentId, status=status)
        return {"rows": [trace.summary() for trace in traces]}

    @app.get("/traces/{trace_id}")
    async def get_trace(trace_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        trace = await _call(scoped(user_id).get_trace, trace_id)
        if trace is None:
            raise HTTPException(status_code=404, detail="Trace not found")
        spans = [span.as_dict() for span in await _call(scoped(user_id).list_trace_spans, trace_id)]
        return {"summary": trace.summary(span_count=1 + len(spans)), "spans": spans}

    return app


async def _execute_background_run(
    client: LocalClient,
    store: RunStore,
    run_id: str,
    agent_id: str,
    input_value: Any,
    session_id: str,
    context: list[str] | None,
) -> None:
    try:
        result = await client._execute(
            agent_id=agent_id,
            input=input_value,
            session_id=session_id,
            context=context,
        )
        current = store.get_run(run_id)
        if current is None or current.status == "cancelled":
            return
        store.put_run(
            LocalRunRecord(
                id=run_id,
                root_id=run_id,
                agent_id=agent_id.split("@", 1)[0],
                session_id=session_id,
                status="completed",
                input=input_value,
                output=result.output,
            )
        )
    except Exception as exc:
        store.put_run(
            LocalRunRecord(
                id=run_id,
                root_id=run_id,
                agent_id=agent_id.split("@", 1)[0],
                session_id=session_id,
                status="failed",
                input=input_value,
                error=str(exc),
            )
        )


async def _create_eval_run(
    store: Any,
    client: LocalClient,
    *,
    eval_id: str,
    dataset_id: str | None,
    agent_version: str | None,
) -> EvalRun:
    definition = store.get_eval(eval_id)
    if definition is None:
        raise ValueError(f'Eval "{eval_id}" not found')
    dataset = store.get_dataset(dataset_id or definition.default_dataset_id)
    if dataset is None:
        raise ValueError("Dataset not found")
    if dataset.agent_id != definition.agent_id:
        raise ValueError(
            f'Dataset "{dataset.id}" belongs to agent "{dataset.agent_id}", '
            f'not "{definition.agent_id}"'
        )
    agent_ref = f"{definition.agent_id}@{agent_version}" if agent_version else definition.agent_id
    _manifest, agent, version = client._resolve_manifest(agent_ref)
    run = EvalRun(
        id=f"evalrun_{nanoid()}",
        evalId=definition.id,
        datasetId=dataset.id,
        agentId=definition.agent_id,
        agentVersion=version or agent.created_at,
        requestedAgentVersion=agent_version,
        status="running",
        startedAt=_iso_now(),
        snapshots=EvalRunSnapshots(
            eval=definition,
            dataset=dataset,
            agent=agent,
            agentVersion=version or agent.created_at,
            requestedAgentVersion=agent_version,
        ),
        caseResults=[],
    )
    store.put_eval_run(run)
    return run


async def _execute_eval_run(
    store: Any,
    client: LocalClient,
    run_id: str,
    cancelled: set[str],
) -> None:
    run = store.get_eval_run(run_id)
    if run is None:
        return
    definition = run.snapshots.eval
    judge_id = f"__agntz_eval_judge_{run.id}"
    judge_agent = create_eval_judge_agent(judge_id, definition)
    client.manifests[judge_id] = _manifest_from_stored_agent(
        judge_agent,
        prompt="{{userQuery}}",
    )

    async def invoke_target(agent_ref: str, input_value: Any) -> TargetInvocation:
        outcome = await client._execute_with_metadata(agent_id=agent_ref, input=input_value)
        return TargetInvocation(
            output=outcome.result.output,
            usage=outcome.usage,
            invocation_id=outcome.invocation_id,
            run_id=outcome.run_id,
        )

    async def invoke_judge(
        eval_definition: EvalDefinition,
        dataset: Any,
        item: Any,
        output: Any,
    ) -> Any:
        judge_prompt = build_judge_prompt(eval_definition, dataset, item, output)
        judged = await client._execute_with_metadata(agent_id=judge_id, input=judge_prompt)
        return judged.result.output

    try:
        await execute_eval_run(
            store,
            run_id,
            invoke_target=invoke_target,
            invoke_judge=invoke_judge,
            cancel=lambda: run_id in cancelled,
        )
    finally:
        client.manifests.pop(judge_id, None)
        cancelled.discard(run_id)


async def _assert_eval_dataset_scope(store: Any, definition: EvalDefinition) -> None:
    if not definition.default_dataset_id:
        return
    dataset = await _call(store.get_dataset, definition.default_dataset_id)
    if dataset is None:
        raise ValueError(f'Dataset "{definition.default_dataset_id}" not found')
    if dataset.agent_id != definition.agent_id:
        raise ValueError(
            f'Dataset "{dataset.id}" belongs to agent "{dataset.agent_id}", '
            f'not "{definition.agent_id}"'
        )


async def _json_body(request: Any) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


async def _call(fn: Any, *args: Any, **kwargs: Any) -> Any:
    return await asyncio.to_thread(fn, *args, **kwargs)


def _dump(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "model_dump"):
        return value.model_dump(by_alias=True, exclude_none=True)
    return value


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _run_record_json(row: LocalRunRecord, user_id: str) -> dict[str, Any]:
    now = int(time.time() * 1000)
    body: dict[str, Any] = {
        "id": row.id,
        "rootId": row.root_id,
        "agentId": row.agent_id,
        "userId": user_id,
        "sessionId": row.session_id,
        "status": row.status,
        "input": row.input,
        "startedAt": now,
        "depth": 0,
    }
    if row.output is not None:
        body["result"] = {
            "output": row.output,
            "invocationId": f"inv_{nanoid()}",
            "sessionId": row.session_id,
            "toolCalls": [],
            "usage": {"promptTokens": 0, "completionTokens": 0, "totalTokens": 0},
            "duration": 0,
            "model": "",
        }
    if row.error is not None:
        body["error"] = row.error
    return body


def _filter_params(params: dict[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in params.items():
        if key == "limit":
            out[key] = int(value)
        else:
            out[key] = value
    return out


def _iso_now() -> str:
    return datetime.now(tz=UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
