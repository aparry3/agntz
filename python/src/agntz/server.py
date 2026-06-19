"""ASGI app factory for hosted Python Agntz deployments."""
# pyright: reportMissingImports=false

from __future__ import annotations

import asyncio
import inspect
import json
import time
from collections.abc import AsyncIterator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, NoReturn

from agntz.client.models import (
    EvalDefinition,
    EvalRun,
    EvalRunSnapshots,
)
from agntz.context import NamespaceGrantError, normalize_namespace_grant
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
from agntz.memrez import (
    MemoryEntry,
    Memrez,
    MemrezCorrectionError,
    MemrezEntryNotFoundError,
    MemrezScopeError,
    TopicSummary,
)
from agntz.platform import (
    NAMESPACE_UNBOUNDED_PERMISSION,
    AuthContext,
    ForbiddenError,
    assert_scope_within_roots,
    narrow_to_roots,
)
from agntz.platform import (
    resolve_allowed_roots as resolve_platform_allowed_roots,
)
from agntz.platform.memory import PlatformMemoryStore
from agntz.sdk.local import (
    LocalClient,
    _agent_from_payload,
    _dataset_from_payload,
    _eval_from_payload,
    _manifest_from_stored_agent,
)
from agntz.stores import RunStore
from agntz.stores.memory import LocalMessageRecord, LocalRunRecord

__all__ = ["NAMESPACE_UNBOUNDED_PERMISSION", "create_app"]


def create_app(
    *,
    store: Any | None = None,
    internal_secret: str,
    model_provider: ModelProvider | None = None,
    tools: list[ToolDefinition] | None = None,
    resources: Mapping[str, ResourceProvider] | None = None,
    memrez: Memrez | None = None,
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

    backing_store = store or PlatformMemoryStore()
    # Memory lives on the namespace axis, not the per-user axis: a single shared memrez instance
    # plus the tenant-scoped namespace roots are the ONLY isolation for memory/scope ops. So these
    # routes use `backing_store` (unscoped) for roots and the shared `memrez` for data — never
    # `scoped(user_id)`.
    resolved_resources: dict[str, ResourceProvider] = dict(resources or {})
    if memrez is not None and "memory" not in resolved_resources:
        resolved_resources["memory"] = memrez.provider()
    app = FastAPI(title="Agntz Python Server")
    eval_cancelled: set[str] = set()

    async def auth_context(request: Request) -> AuthContext:
        internal = request.headers.get("x-internal-secret")
        if internal and internal == internal_secret:
            body = await _json_body(request)
            user_id = body.get("userId") or request.headers.get("x-user-id")
            if not isinstance(user_id, str) or not user_id:
                raise HTTPException(
                    status_code=400,
                    detail="internal request missing userId in body or X-User-Id header",
                )
            return AuthContext(
                user_id=user_id,
                auth_method="internal",
                permissions=_permissions_from_request(request, body),
            )
        auth = request.headers.get("authorization")
        if auth and auth.startswith("Bearer "):
            raw_key = auth[len("Bearer ") :].strip()
            resolved = await _call(backing_store.resolve_api_key, raw_key)
            if resolved is None:
                raise HTTPException(status_code=401, detail="invalid or revoked API key")
            user_id = resolved.get("user_id") or resolved.get("userId")
            if isinstance(user_id, str):
                # An API key can NEVER claim cross-tenant (unbounded) access.
                return AuthContext(user_id=user_id, auth_method="api_key", permissions=[])
        raise HTTPException(status_code=401, detail="missing authentication")

    async def user_id_from_auth(request: Request) -> str:
        ctx = await auth_context(request)
        return ctx.user_id

    async def resolve_allowed_roots(ctx: AuthContext) -> Any:
        return await _call(resolve_platform_allowed_roots, ctx, backing_store)

    def require_memrez() -> Memrez:
        if memrez is None:
            raise HTTPException(status_code=503, detail="memory is not configured on this server")
        return memrez

    def require_grants(request: Request) -> list[str]:
        grants = _split_csv_params(request.query_params.getlist("grants"))
        if not grants:
            raise HTTPException(status_code=400, detail="grants query parameter is required")
        return grants

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
            resources=resolved_resources,
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
        if body.get("callbackUrl") is not None or body.get("webhookSecretName") is not None:
            raise HTTPException(
                status_code=501,
                detail="Python server does not support run webhooks yet",
            )
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
        if body.get("callbackUrl") is not None or body.get("webhookSecretName") is not None:
            raise HTTPException(
                status_code=501,
                detail="Python server does not support run webhooks yet",
            )
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

    @app.post("/sessions/import")
    async def import_sessions(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        body = await _json_body(request)
        try:
            snapshots = _normalize_session_import_items(body.get("sessions"))
            on_conflict = _normalize_snapshot_conflict(body.get("onConflict"))
            dry_run = body.get("dryRun") is True
            scoped_store = scoped(user_id)
            results: list[dict[str, Any]] = []
            for snapshot in snapshots:
                existing = await _call(scoped_store.get_messages, snapshot["sessionId"])
                if existing and on_conflict == "fail":
                    raise ConflictError(f'Session "{snapshot["sessionId"]}" already exists')
                action = "skip" if existing else "create"
                if not dry_run and action != "skip":
                    await _call(
                        scoped_store.append_messages,
                        snapshot["sessionId"],
                        snapshot["messages"],
                        agent_id=snapshot.get("agentId"),
                    )
                results.append(
                    {
                        "sessionId": snapshot["sessionId"],
                        "agentId": snapshot.get("agentId"),
                        "action": action,
                        "messageCount": len(snapshot["messages"]),
                    }
                )
            return {"dryRun": dry_run, "results": results, "counts": _count_actions(results)}
        except ConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/sessions")
    async def list_sessions(
        user_id: str = Depends(user_id_from_auth),
        agentId: str | None = None,
    ) -> Any:
        rows = await _call(scoped(user_id).list_sessions, agent_id=agentId)
        return {"sessions": [_session_summary_json(row) for row in rows]}

    @app.get("/sessions/{session_id}")
    async def get_session(session_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        messages = await _call(scoped(user_id).get_messages, session_id)
        return {"sessionId": session_id, "messages": [_message_record_json(m) for m in messages]}

    @app.delete("/sessions/{session_id}")
    async def delete_session(session_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        await _call(scoped(user_id).delete_session, session_id)
        return JSONResponse(status_code=204, content=None)

    @app.get("/agents")
    async def list_agents(user_id: str = Depends(user_id_from_auth)) -> Any:
        return await _call(scoped(user_id).list_agents)

    @app.post("/agents")
    async def create_agent(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        agent = _agent_from_payload(await _json_body(request))
        row = await _call(scoped(user_id).put_agent, agent)
        return JSONResponse(_dump(row), status_code=201)

    @app.post("/agents/import")
    async def import_agents(request: Request, user_id: str = Depends(user_id_from_auth)) -> Any:
        body = await _json_body(request)
        try:
            items = _normalize_agent_import_items(body.get("agents"))
            on_conflict = _normalize_agent_conflict(body.get("onConflict"))
            dry_run = body.get("dryRun") is True
            scoped_store = scoped(user_id)
            results: list[dict[str, Any]] = []
            for item in items:
                existing = await _call(scoped_store.get_agent, item["id"])
                if existing is not None and on_conflict == "fail":
                    raise ConflictError(f'Agent "{item["id"]}" already exists')
                action = "create" if existing is None else (
                    "skip" if on_conflict == "skip" else "version"
                )
                if not dry_run and action != "skip":
                    await _call(scoped_store.put_agent, item["agent"])
                result = {
                    "id": item["id"],
                    "action": action,
                    "warnings": [],
                }
                if item.get("sourcePath"):
                    result["sourcePath"] = item["sourcePath"]
                results.append(result)
            return {"dryRun": dry_run, "results": results, "counts": _count_actions(results)}
        except ConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

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

    @app.delete("/traces/{trace_id}")
    async def delete_trace(trace_id: str, user_id: str = Depends(user_id_from_auth)) -> Any:
        delete = getattr(scoped(user_id), "delete_trace", None)
        if not callable(delete):
            raise HTTPException(status_code=501, detail="Configured store does not support traces")
        await _call(delete, trace_id)
        return JSONResponse(status_code=204, content=None)

    @app.post("/memory/import")
    async def memory_import(request: Request) -> Any:
        ctx = await auth_context(request)
        mz = require_memrez()
        body = await _json_body(request)
        try:
            entries = _normalize_memory_import_entries(body.get("entries"))
            dry_run = body.get("dryRun") is True
            allowed = await resolve_allowed_roots(ctx)
            planned: list[tuple[MemoryEntry, bool]] = []
            for entry in entries:
                assert_scope_within_roots(allowed, entry.scope)
                existing = await _call(mz.store.get_entry, entry.id)
                if existing is not None:
                    assert_scope_within_roots(allowed, existing.scope)
                planned.append((entry, existing is not None))
            results: list[dict[str, Any]] = []
            for entry, existing in planned:
                if not dry_run:
                    await _call(mz.store.put_entry, entry)
                results.append(
                    {
                        "id": entry.id,
                        "scope": entry.scope,
                        "action": "update" if existing else "create",
                        "status": entry.status,
                    }
                )
            return {"dryRun": dry_run, "results": results, "counts": _count_actions(results)}
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/memory/topics")
    async def memory_topics(request: Request) -> Any:
        ctx = await auth_context(request)
        mz = require_memrez()
        grants = require_grants(request)
        try:
            allowed = await resolve_allowed_roots(ctx)
            scoped_grants = narrow_to_roots(allowed, grants)
            result = await _call(mz.scan, scoped_grants, include_ancestors=allowed.unbounded)
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        return {
            "grants": result["grants"],
            "topics": [_topic_summary_json(topic) for topic in result["topics"]],
        }

    @app.get("/memory/entries")
    async def memory_entries(request: Request) -> Any:
        ctx = await auth_context(request)
        mz = require_memrez()
        grants = require_grants(request)
        topics = _split_csv_params(request.query_params.getlist("topics"))
        include_superseded = _is_truthy(request.query_params.get("includeSuperseded"))
        limit = _clamp_int(request.query_params.get("limit"), default=200, minimum=1, maximum=1000)
        offset = _clamp_int(request.query_params.get("offset"), default=0, minimum=0)
        try:
            allowed = await resolve_allowed_roots(ctx)
            scoped_grants = narrow_to_roots(allowed, grants)
            entries = await _call(
                mz.list,
                scoped_grants,
                topics=topics or None,
                include_superseded=include_superseded,
                include_ancestors=allowed.unbounded,
            )
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        page = entries[offset : offset + limit]
        return {
            "entries": [_memory_entry_json(entry) for entry in page],
            "total": len(entries),
            "limit": limit,
            "offset": offset,
        }

    @app.post("/memory/entries/{entry_id}/correct")
    async def memory_correct(entry_id: str, request: Request) -> Any:
        ctx = await auth_context(request)
        mz = require_memrez()
        body = await _json_body(request)
        raw_grants = body.get("grants")
        content = body.get("content")
        if not isinstance(raw_grants, list) or not raw_grants:
            raise HTTPException(status_code=400, detail="grants must be a non-empty array")
        if not isinstance(content, str) or not content.strip():
            raise HTTPException(status_code=400, detail="content must be a non-empty string")
        try:
            allowed = await resolve_allowed_roots(ctx)
            scoped_grants = narrow_to_roots(allowed, [str(grant) for grant in raw_grants])
            result = await _call(mz.correct, scoped_grants, entry_id, content)
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        return {"entry": _memory_entry_json(result["entry"])}

    @app.delete("/memory/entries/{entry_id}")
    async def memory_delete_entry(entry_id: str, request: Request) -> Any:
        ctx = await auth_context(request)
        mz = require_memrez()
        body = await _json_body(request)
        raw_grants = body.get("grants")
        if isinstance(raw_grants, list) and raw_grants:
            grants = [str(grant) for grant in raw_grants]
        else:
            grants = _split_csv_params(request.query_params.getlist("grants"))
        if not grants:
            raise HTTPException(
                status_code=400,
                detail="grants are required (request body or grants query parameter)",
            )
        try:
            allowed = await resolve_allowed_roots(ctx)
            scoped_grants = narrow_to_roots(allowed, grants)
            result = await _call(mz.delete_entry, scoped_grants, entry_id)
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        return result

    @app.post("/memory/curate")
    async def memory_curate(request: Request) -> Any:
        ctx = await auth_context(request)
        mz = require_memrez()
        body = await _json_body(request)
        raw_grants = body.get("grants")
        try:
            allowed = await resolve_allowed_roots(ctx)
            if raw_grants is None or raw_grants == []:
                # Empty/absent grants = global sweep across every scope; super-admin only.
                if not allowed.unbounded:
                    raise ForbiddenError("global curation requires unbounded (super-admin) access")
                return await _call(_run_curation_sweep, mz)
            if not isinstance(raw_grants, list):
                raise HTTPException(status_code=400, detail="grants must be an array")
            topics_raw = body.get("topics")
            topics = [str(t) for t in topics_raw] if isinstance(topics_raw, list) else None
            scoped_grants = narrow_to_roots(allowed, [str(grant) for grant in raw_grants])
            report = await _call(
                mz.curate,
                scoped_grants,
                topics=topics,
                # Bounded callers curate EXACT grants only (include_descendants=True); the
                # super-admin/unbounded path keeps ancestor expansion (False).
                include_descendants=not allowed.unbounded,
            )
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        return {"curateEnabled": True, "report": report}

    @app.post("/scopes/delete")
    async def scopes_delete(request: Request) -> Any:
        ctx = await auth_context(request)
        if not resolved_resources:
            raise HTTPException(status_code=503, detail="memory is not configured on this server")
        body = await _json_body(request)
        scope = body.get("scope")
        if not isinstance(scope, str) or not scope.strip():
            raise HTTPException(status_code=400, detail="scope must be a non-empty string")
        recursive = body.get("recursive") is not False
        try:
            allowed = await resolve_allowed_roots(ctx)
            normalized_scope = assert_scope_within_roots(allowed, scope)
        except _MEMORY_ERRORS as exc:
            raise HTTPException(status_code=_memory_error_status(exc), detail=str(exc)) from exc
        by_resource: dict[str, int] = {}
        total = 0
        for kind, provider in resolved_resources.items():
            purge = getattr(provider, "purge_scope", None)
            if not callable(purge):
                continue
            if inspect.iscoroutinefunction(purge):
                result = await purge(normalized_scope, recursive=recursive)
            else:
                result = await _call(purge, normalized_scope, recursive=recursive)
            deleted = int(result.get("deleted", 0)) if isinstance(result, dict) else 0
            by_resource[kind] = deleted
            total += deleted
        return {
            "scope": normalized_scope,
            "recursive": recursive,
            "total": total,
            "byResource": by_resource,
        }

    @app.get("/namespace-roots")
    async def get_namespace_roots(user_id: str = Depends(user_id_from_auth)) -> Any:
        return {"roots": await _call(backing_store.list_namespace_roots, user_id)}

    @app.post("/namespace-roots")
    async def post_namespace_root(
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        normalized = _validate_root(await _json_body(request), HTTPException)
        await _call(backing_store.add_namespace_root, user_id, normalized)
        roots = await _call(backing_store.list_namespace_roots, user_id)
        return JSONResponse({"roots": roots}, status_code=201)

    @app.delete("/namespace-roots")
    async def delete_namespace_root(
        request: Request,
        user_id: str = Depends(user_id_from_auth),
    ) -> Any:
        normalized = _validate_root(await _json_body(request), HTTPException)
        await _call(backing_store.remove_namespace_root, user_id, normalized)
        return {"roots": await _call(backing_store.list_namespace_roots, user_id)}

    return app


class ConflictError(ValueError):
    """Request conflicts with existing stored data."""


def _count_actions(results: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for result in results:
        action = str(result.get("action") or "")
        counts[action] = counts.get(action, 0) + 1
    return counts


def _normalize_agent_conflict(value: Any) -> str:
    if value is None:
        return "version"
    if value in {"version", "skip", "fail"}:
        return str(value)
    raise ValueError("onConflict must be one of: version, skip, fail")


def _normalize_snapshot_conflict(value: Any) -> str:
    if value is None:
        return "skip"
    if value in {"skip", "fail"}:
        return str(value)
    raise ValueError("onConflict must be one of: skip, fail")


def _normalize_agent_import_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ValueError("Body must include a non-empty agents array")
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"agents[{index}] must be an object")
        manifest = raw.get("manifest")
        if not isinstance(manifest, str) or not manifest.strip():
            raise ValueError(f"agents[{index}].manifest must be a non-empty string")
        payload: dict[str, Any] = {"manifest": manifest}
        if isinstance(raw.get("id"), str) and raw["id"].strip():
            payload["id"] = raw["id"].strip()
        if isinstance(raw.get("sourcePath"), str) and raw["sourcePath"].strip():
            payload["sourcePath"] = raw["sourcePath"].strip()
        try:
            agent = _agent_from_payload(payload)
        except Exception as exc:
            raise ValueError(f"agents[{index}].manifest could not be parsed: {exc}") from exc
        if agent.id in seen:
            raise ValueError(f"Duplicate agent id in import batch: {agent.id}")
        seen.add(agent.id)
        output.append(
            {
                "id": agent.id,
                "agent": agent,
                "sourcePath": payload.get("sourcePath"),
            }
        )
    return output


def _normalize_session_import_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ValueError("Body must include a non-empty sessions array")
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"sessions[{index}] must be an object")
        session_id = raw.get("sessionId")
        if not isinstance(session_id, str) or not session_id.strip():
            raise ValueError(f"sessions[{index}].sessionId must be a non-empty string")
        if session_id in seen:
            raise ValueError(f"Duplicate session id in import batch: {session_id}")
        seen.add(session_id)
        messages_raw = raw.get("messages")
        if not isinstance(messages_raw, list):
            raise ValueError(f"sessions[{index}].messages must be an array")
        agent_id = raw.get("agentId") if isinstance(raw.get("agentId"), str) else None
        messages = [
            _normalize_session_message(
                message,
                f"sessions[{index}].messages[{msg_index}]",
                session_id,
                agent_id,
            )
            for msg_index, message in enumerate(messages_raw)
        ]
        output.append({"sessionId": session_id, "agentId": agent_id, "messages": messages})
    return output


def _normalize_session_message(
    value: Any,
    path: str,
    session_id: str,
    agent_id: str | None,
) -> LocalMessageRecord:
    if not isinstance(value, dict):
        raise ValueError(f"{path} must be an object")
    role = value.get("role")
    if role not in {"system", "user", "assistant", "tool"}:
        raise ValueError(f"{path}.role must be system, user, assistant, or tool")
    content = value.get("content")
    if not isinstance(content, str) and not isinstance(content, list):
        raise ValueError(f"{path}.content must be a string or content-block array")
    timestamp = value.get("timestamp")
    if not isinstance(timestamp, str) or not timestamp:
        raise ValueError(f"{path}.timestamp must be a non-empty string")
    tool_calls = value.get("toolCalls", value.get("tool_calls"))
    if tool_calls is not None and not isinstance(tool_calls, list):
        raise ValueError(f"{path}.toolCalls must be an array when provided")
    tool_call_id = value.get("toolCallId", value.get("tool_call_id"))
    if tool_call_id is not None and not isinstance(tool_call_id, str):
        raise ValueError(f"{path}.toolCallId must be a string when provided")
    return LocalMessageRecord(
        session_id=session_id,
        agent_id=agent_id,
        role=str(role),
        content=content,
        timestamp=timestamp,
        tool_calls=tool_calls,
        tool_call_id=tool_call_id,
    )


def _normalize_memory_import_entries(value: Any) -> list[MemoryEntry]:
    if not isinstance(value, list) or not value:
        raise ValueError("Body must include a non-empty entries array")
    seen: set[str] = set()
    output: list[MemoryEntry] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"entries[{index}] must be an object")
        entry_id = _required_str(raw, "id", f"entries[{index}]")
        if entry_id in seen:
            raise ValueError(f"Duplicate memory entry id in import batch: {entry_id}")
        seen.add(entry_id)
        topics = raw.get("topics")
        if not isinstance(topics, list) or not all(isinstance(topic, str) for topic in topics):
            raise ValueError(f"entries[{index}].topics must be a string array")
        entry_type = _required_str(raw, "type", f"entries[{index}]")
        if entry_type not in {"fact", "preference", "event", "summary"}:
            raise ValueError(f"entries[{index}].type must be fact, preference, event, or summary")
        status = _required_str(raw, "status", f"entries[{index}]")
        if status not in {"active", "superseded"}:
            raise ValueError(f"entries[{index}].status must be active or superseded")
        source_raw = raw.get("source")
        source = dict(source_raw) if isinstance(source_raw, dict) else None
        output.append(
            MemoryEntry(
                id=entry_id,
                scope=_required_str(raw, "scope", f"entries[{index}]"),
                content=_required_str(raw, "content", f"entries[{index}]"),
                topics=list(topics),
                type=entry_type,  # type: ignore[arg-type]
                status=status,  # type: ignore[arg-type]
                created_at=_required_str(raw, "createdAt", f"entries[{index}]"),
                updated_at=_required_str(raw, "updatedAt", f"entries[{index}]"),
                source=source,  # type: ignore[arg-type]
                superseded_by=(
                    raw.get("supersededBy") if isinstance(raw.get("supersededBy"), str) else None
                ),
            )
        )
    return output


def _required_str(raw: dict[str, Any], key: str, path: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{path}.{key} must be a non-empty string")
    return value


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


def _session_summary_json(row: Any) -> dict[str, Any]:
    return {
        "sessionId": row.session_id,
        "agentId": row.agent_id,
        "messageCount": row.message_count,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    }


def _message_record_json(row: LocalMessageRecord) -> dict[str, Any]:
    body: dict[str, Any] = {
        "role": row.role,
        "content": row.content,
        "timestamp": row.timestamp,
    }
    if row.agent_id is not None:
        body["agentId"] = row.agent_id
    if row.tool_calls is not None:
        body["toolCalls"] = row.tool_calls
    if row.tool_call_id is not None:
        body["toolCallId"] = row.tool_call_id
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


_MEMORY_ERRORS = (
    MemrezEntryNotFoundError,
    MemrezCorrectionError,
    MemrezScopeError,
    NamespaceGrantError,
    ForbiddenError,
)


def _permissions_from_request(request: Any, body: dict[str, Any]) -> list[str]:
    # Python's internal auth has no signed identity token; a super-admin (the app) carries
    # `namespace:unbounded` via the X-Agntz-Permissions header or a `permissions` body array.
    header = request.headers.get("x-agntz-permissions")
    if header:
        return [part.strip() for part in header.split(",") if part.strip()]
    raw = body.get("permissions")
    if isinstance(raw, list):
        return [str(item) for item in raw]
    return []


def _memory_error_status(exc: Exception) -> int:
    if isinstance(exc, MemrezEntryNotFoundError):
        return 404
    if isinstance(exc, MemrezCorrectionError):
        return 409
    if isinstance(exc, ForbiddenError):
        return 403
    if isinstance(exc, MemrezScopeError | NamespaceGrantError):
        return 400
    return 500


def _memory_entry_json(entry: MemoryEntry) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": entry.id,
        "scope": entry.scope,
        "content": entry.content,
        "topics": list(entry.topics),
        "type": entry.type,
        "status": entry.status,
        "createdAt": entry.created_at,
        "updatedAt": entry.updated_at,
    }
    if entry.source is not None:
        body["source"] = dict(entry.source)
    if entry.superseded_by is not None:
        body["supersededBy"] = entry.superseded_by
    return body


def _topic_summary_json(topic: TopicSummary) -> dict[str, Any]:
    body: dict[str, Any] = {
        "topic": topic.topic,
        "count": topic.count,
        "lastUpdatedAt": topic.last_updated_at,
        "hasUncuratedWrites": topic.has_uncurated_writes,
    }
    if topic.blurb is not None:
        body["blurb"] = topic.blurb
    return body


def _run_curation_sweep(memrez: Memrez) -> dict[str, Any]:
    if not callable(getattr(memrez.reasoner, "curate", None)):
        return {"curateEnabled": False, "dirty": 0, "scopes": []}
    dirty = memrez.store.list_dirty_topics()
    by_scope: dict[str, list[str]] = {}
    for item in dirty:
        by_scope.setdefault(item.scope, []).append(item.topic)
    scopes: list[dict[str, Any]] = []
    for scope, topics in by_scope.items():
        try:
            report = memrez.curate([scope], topics=topics, include_descendants=True)
            scopes.append({"scope": scope, "report": report})
        except Exception as exc:
            scopes.append({"scope": scope, "error": str(exc)})
    return {"curateEnabled": True, "dirty": len(dirty), "scopes": scopes}


def _split_csv_params(values: Sequence[str]) -> list[str]:
    output: list[str] = []
    for value in values:
        for part in value.split(","):
            stripped = part.strip()
            if stripped:
                output.append(stripped)
    return output


def _is_truthy(value: str | None) -> bool:
    return value is not None and value.strip().lower() in {"1", "true", "yes"}


def _clamp_int(
    value: str | None,
    *,
    default: int,
    minimum: int,
    maximum: int | None = None,
) -> int:
    if value is None or not value.strip():
        return default
    try:
        parsed = int(value)
    except ValueError:
        return default
    if parsed < minimum:
        return minimum
    if maximum is not None and parsed > maximum:
        return maximum
    return parsed


def _validate_root(body: dict[str, Any], http_exception: Any) -> str:
    root = body.get("root")
    if not isinstance(root, str) or not root.strip():
        raise http_exception(status_code=400, detail="root must be a non-empty string")
    try:
        return normalize_namespace_grant(root)
    except NamespaceGrantError as exc:
        raise http_exception(status_code=400, detail=f"Invalid namespace root: {exc}") from exc
