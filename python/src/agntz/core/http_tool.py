"""HTTP tool execution for embedded local manifests."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

import httpx

from agntz.manifest import ToolCallConfig, interpolate
from agntz.manifest.types import AgentState


async def invoke_http_tool(
    config: ToolCallConfig,
    state: AgentState,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> Any:
    if not config.url:
        raise RuntimeError(f"HTTP tool '{config.name}' must define a url")

    params = {key: str(value) for key, value in (config.params or {}).items()}
    render_state = {**state, **params}
    url = _replace_url_params(interpolate(config.url, render_state), params)
    headers = {
        key: interpolate(value, render_state) for key, value in (config.headers or {}).items()
    }
    method = (config.method or "GET").upper()
    body = _render_value(config.body, render_state)

    request_kwargs: dict[str, Any] = {"headers": headers}
    if method == "GET":
        url = _append_query(url, params)
    elif config.body_type == "form":
        request_kwargs["data"] = body if isinstance(body, dict) else params
    elif config.body_type == "query":
        url = _append_query(url, body if isinstance(body, dict) else params)
    elif body is not None:
        request_kwargs["json"] = body
    elif params:
        request_kwargs["json"] = params

    owns_client = http_client is None
    client = http_client or httpx.AsyncClient()
    try:
        response = await client.request(method, url, **request_kwargs)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return response.text
    finally:
        if owns_client:
            await client.aclose()


def _replace_url_params(url: str, params: dict[str, str]) -> str:
    rendered = url
    for key, value in params.items():
        rendered = rendered.replace("{" + key + "}", quote(value, safe=""))
        rendered = rendered.replace("{" + key + "?}", quote(value, safe=""))
    return rendered


def _append_query(url: str, params: dict[str, Any]) -> str:
    if not params:
        return url
    parts = urlsplit(url)
    query = "&".join(part for part in [parts.query, urlencode(params)] if part)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


def _render_value(value: Any, state: AgentState) -> Any:
    if isinstance(value, str):
        return interpolate(value, state)
    if isinstance(value, list):
        return [_render_value(item, state) for item in value]
    if isinstance(value, dict):
        return {key: _render_value(item, state) for key, item in value.items()}
    return value
