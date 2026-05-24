"""Minimal MCP HTTP tool execution for embedded local manifests."""

from __future__ import annotations

from typing import Any

import httpx

from agntz.manifest import ToolCallConfig, interpolate
from agntz.manifest.types import AgentState


async def invoke_mcp_tool(
    config: ToolCallConfig,
    state: AgentState,
    *,
    http_client: httpx.AsyncClient | None = None,
) -> Any:
    if not config.server:
        raise RuntimeError(f"MCP tool '{config.name}' must define a server")

    arguments = {
        key: interpolate(str(value), state) for key, value in (config.params or {}).items()
    }
    payload = {
        "jsonrpc": "2.0",
        "id": "agntz-python-tool-call",
        "method": "tools/call",
        "params": {
            "name": config.name,
            "arguments": arguments,
        },
    }
    owns_client = http_client is None
    client = http_client or httpx.AsyncClient()
    try:
        response = await client.post(
            config.server,
            json=payload,
            headers={"Accept": "application/json, text/event-stream"},
        )
        response.raise_for_status()
        data = response.json()
    finally:
        if owns_client:
            await client.aclose()

    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"MCP tool '{config.name}' failed: {data['error']}")
    if isinstance(data, dict) and "result" in data:
        return data["result"]
    return data
