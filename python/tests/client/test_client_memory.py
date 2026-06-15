from __future__ import annotations

from typing import Any

import httpx

from agntz import AgntzClient, AsyncAgntzClient
from agntz.client import (
    MemoryEntry,
    MemoryScanResult,
    ScopeDeleteResult,
)

_ENTRY = {
    "id": "mem_1",
    "scope": "acme/team",
    "content": "note",
    "topics": ["notes"],
    "type": "fact",
    "status": "active",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-02T00:00:00.000Z",
    "supersededBy": None,
}


def _handler(seen: list[httpx.Request]) -> Any:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path == "/memory/topics":
            return httpx.Response(
                200,
                json={
                    "grants": ["acme/team"],
                    "topics": [
                        {
                            "topic": "notes",
                            "count": 2,
                            "blurb": "b",
                            "lastUpdatedAt": "2026-01-02T00:00:00.000Z",
                            "hasUncuratedWrites": True,
                        }
                    ],
                },
            )
        if path == "/memory/entries":
            return httpx.Response(
                200, json={"entries": [_ENTRY], "total": 1, "limit": 200, "offset": 0}
            )
        if path.endswith("/correct"):
            return httpx.Response(200, json={"entry": _ENTRY})
        if path.startswith("/memory/entries/"):
            return httpx.Response(200, json={"deleted": True, "id": "mem_1"})
        if path == "/memory/curate":
            return httpx.Response(
                200,
                json={
                    "curateEnabled": True,
                    "report": {
                        "scanned": 3,
                        "superseded": 1,
                        "created": 1,
                        "blurbsUpdated": 2,
                    },
                },
            )
        if path == "/scopes/delete":
            return httpx.Response(
                200,
                json={
                    "scope": "acme/team",
                    "recursive": True,
                    "total": 4,
                    "byResource": {"memory": 4},
                },
            )
        return httpx.Response(404, json={"error": "not found"})

    return handle


def _client(seen: list[httpx.Request]) -> AgntzClient:
    return AgntzClient(
        api_key="k",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(_handler(seen))),
    )


def test_scan_sends_comma_joined_grants() -> None:
    seen: list[httpx.Request] = []
    result = _client(seen).memory.scan(["acme/team", "acme/ops"])
    assert isinstance(result, MemoryScanResult)
    assert result.topics[0].has_uncurated_writes is True
    assert seen[0].method == "GET"
    assert seen[0].url.path == "/memory/topics"
    assert seen[0].url.params["grants"] == "acme/team,acme/ops"


def test_list_sets_pagination_and_superseded_flags() -> None:
    seen: list[httpx.Request] = []
    entries = _client(seen).memory.list(
        ["acme/team"], topics=["notes"], include_superseded=True, limit=10, offset=5
    )
    assert [e.id for e in entries] == ["mem_1"]
    assert isinstance(entries[0], MemoryEntry)
    params = seen[0].url.params
    assert params["grants"] == "acme/team"
    assert params["topics"] == "notes"
    assert params["includeSuperseded"] == "true"
    assert params["limit"] == "10"
    assert params["offset"] == "5"


def test_read_unwraps_entries() -> None:
    seen: list[httpx.Request] = []
    entries = _client(seen).memory.read(["acme/team"], "notes", limit=3)
    assert [e.id for e in entries] == ["mem_1"]
    assert seen[0].url.params["topics"] == "notes"


def test_delete_entry_passes_grants_in_query() -> None:
    seen: list[httpx.Request] = []
    result = _client(seen).memory.delete_entry(["acme/team"], "mem_1")
    assert result.deleted is True
    assert seen[0].method == "DELETE"
    assert seen[0].url.path == "/memory/entries/mem_1"
    assert seen[0].url.params["grants"] == "acme/team"


def test_correct_sends_body_and_unwraps_entry() -> None:
    seen: list[httpx.Request] = []
    out = _client(seen).memory.correct(["acme/team"], "mem_1", "fixed")
    assert out["entry"].id == "mem_1"
    assert seen[0].method == "POST"
    assert seen[0].url.path == "/memory/entries/mem_1/correct"
    import json

    assert json.loads(seen[0].content) == {"grants": ["acme/team"], "content": "fixed"}


def test_curate_camel_case_round_trip() -> None:
    seen: list[httpx.Request] = []
    result = _client(seen).memory.curate(["acme/team"], topics=["notes"])
    assert result.curate_enabled is True
    assert result.report.blurbs_updated == 2


def test_delete_scope_sends_scope_and_recursive() -> None:
    seen: list[httpx.Request] = []
    result = _client(seen).memory.delete_scope(["acme/team"], "acme/team", recursive=True)
    assert isinstance(result, ScopeDeleteResult)
    assert result.by_resource == {"memory": 4}
    assert seen[0].url.path == "/scopes/delete"
    import json

    assert json.loads(seen[0].content) == {
        "scope": "acme/team",
        "grants": ["acme/team"],
        "recursive": True,
    }


async def test_async_memory_resource_round_trip() -> None:
    seen: list[httpx.Request] = []
    client = AsyncAgntzClient(
        api_key="k",
        base_url="https://worker.test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(_handler(seen))),
    )
    scan = await client.memory.scan(["acme/team"])
    assert scan.grants == ["acme/team"]
    entries = await client.memory.list(["acme/team"])
    assert entries[0].id == "mem_1"
    deleted = await client.memory.delete_scope(["acme/team"], "acme/team")
    assert deleted.total == 4
    await client.aclose()
