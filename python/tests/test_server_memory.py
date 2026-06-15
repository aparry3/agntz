from __future__ import annotations

from typing import Any

import httpx

from agntz.memrez import DeterministicReasoner, InMemoryMemoryStore, create_memrez
from agntz.server import NAMESPACE_UNBOUNDED_PERMISSION, create_app
from agntz.stores import MemoryStore

SECRET = "s3cret"
ADMIN = {
    "X-Internal-Secret": SECRET,
    "X-User-Id": "admin",
    "X-Agntz-Permissions": NAMESPACE_UNBOUNDED_PERMISSION,
}


def _bearer(key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {key}"}


def _setup() -> tuple[Any, MemoryStore, Any, dict[str, str]]:
    store = MemoryStore()
    memrez = create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())
    store.add_namespace_root("userA", "acme")
    store.add_namespace_root("userB", "globex")
    keys = {
        "A": store.create_api_key(user_id="userA", name="A")["rawKey"],
        "B": store.create_api_key(user_id="userB", name="B")["rawKey"],
        "C": store.create_api_key(user_id="userC", name="C")["rawKey"],  # no roots
    }
    memrez.write(["acme/team"], "A team note", topics_hint=["notes"])
    memrez.write(["acme"], "ANCESTOR SECRET", topics_hint=["notes"])
    memrez.write(["globex/team"], "B team note", topics_hint=["notes"])
    app = create_app(store=store, internal_secret=SECRET, memrez=memrez)
    return app, store, memrez, keys


def _client(app: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_api_key_bounded_to_its_roots() -> None:
    app, _store, _memrez, keys = _setup()
    async with _client(app) as c:
        ok = await c.get(
            "/memory/topics", params={"grants": "acme/team"}, headers=_bearer(keys["A"])
        )
        assert ok.status_code == 200
        escaped = await c.get(
            "/memory/topics", params={"grants": "globex/team"}, headers=_bearer(keys["A"])
        )
        assert escaped.status_code == 400


async def test_tenant_without_roots_is_forbidden() -> None:
    app, _store, _memrez, keys = _setup()
    async with _client(app) as c:
        resp = await c.get(
            "/memory/topics", params={"grants": "acme/team"}, headers=_bearer(keys["C"])
        )
        assert resp.status_code == 403


async def test_ancestor_scope_not_leaked_to_bounded_caller() -> None:
    app, _store, _memrez, keys = _setup()
    async with _client(app) as c:
        resp = await c.get(
            "/memory/entries", params={"grants": "acme/team"}, headers=_bearer(keys["A"])
        )
        assert resp.status_code == 200
        contents = [entry["content"] for entry in resp.json()["entries"]]
        assert "A team note" in contents
        assert "ANCESTOR SECRET" not in contents


async def test_super_admin_is_unbounded_and_keeps_ancestors() -> None:
    app, _store, _memrez, _keys = _setup()
    async with _client(app) as c:
        entries = await c.get("/memory/entries", params={"grants": "acme/team"}, headers=ADMIN)
        contents = [entry["content"] for entry in entries.json()["entries"]]
        assert "ANCESTOR SECRET" in contents
        cross = await c.get("/memory/topics", params={"grants": "globex/team"}, headers=ADMIN)
        assert cross.status_code == 200


async def test_scope_delete_blocks_cross_tenant() -> None:
    app, _store, memrez, keys = _setup()
    async with _client(app) as c:
        resp = await c.post(
            "/scopes/delete", json={"scope": "acme/team"}, headers=_bearer(keys["B"])
        )
        assert resp.status_code == 400
    # nothing was deleted
    assert {e.scope for e in memrez.store.list_entries()} >= {"acme/team", "globex/team"}


async def test_scope_delete_within_roots() -> None:
    app, _store, memrez, keys = _setup()
    async with _client(app) as c:
        resp = await c.post(
            "/scopes/delete", json={"scope": "acme/team"}, headers=_bearer(keys["A"])
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["byResource"] == {"memory": 1}
        assert body["total"] == 1 and body["recursive"] is True
    assert "A team note" not in [e.content for e in memrez.store.list_entries()]


async def test_correct_then_delete_entry_within_roots() -> None:
    app, _store, memrez, keys = _setup()
    entry_id = next(e.id for e in memrez.store.list_entries() if e.scope == "acme/team")
    async with _client(app) as c:
        corrected = await c.post(
            f"/memory/entries/{entry_id}/correct",
            json={"grants": ["acme/team"], "content": "edited"},
            headers=_bearer(keys["A"]),
        )
        assert corrected.status_code == 200
        new_id = corrected.json()["entry"]["id"]
        deleted = await c.request(
            "DELETE",
            f"/memory/entries/{new_id}",
            json={"grants": ["acme/team"]},
            headers=_bearer(keys["A"]),
        )
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": True, "id": new_id}


async def test_curate_global_sweep_requires_super_admin() -> None:
    app, _store, _memrez, keys = _setup()
    async with _client(app) as c:
        forbidden = await c.post("/memory/curate", json={}, headers=_bearer(keys["A"]))
        assert forbidden.status_code == 403
        scoped = await c.post(
            "/memory/curate", json={"grants": ["acme/team"]}, headers=_bearer(keys["A"])
        )
        assert scoped.status_code == 200
        assert scoped.json()["curateEnabled"] is True
        sweep = await c.post("/memory/curate", json={}, headers=ADMIN)
        assert sweep.status_code == 200
        assert "curateEnabled" in sweep.json()


async def test_namespace_roots_crud() -> None:
    app, _store, _memrez, keys = _setup()
    async with _client(app) as c:
        listed = await c.get("/namespace-roots", headers=_bearer(keys["A"]))
        assert listed.json() == {"roots": ["acme"]}
        added = await c.post("/namespace-roots", json={"root": "acme2"}, headers=_bearer(keys["A"]))
        assert added.status_code == 201
        assert "acme2" in added.json()["roots"]
        bad = await c.post("/namespace-roots", json={"root": ""}, headers=_bearer(keys["A"]))
        assert bad.status_code == 400
        removed = await c.request(
            "DELETE", "/namespace-roots", json={"root": "acme2"}, headers=_bearer(keys["A"])
        )
        assert removed.json() == {"roots": ["acme"]}


async def test_memory_routes_503_when_memrez_not_configured() -> None:
    app = create_app(store=MemoryStore(), internal_secret=SECRET)
    headers = {"X-Internal-Secret": SECRET, "X-User-Id": "u"}
    async with _client(app) as c:
        resp = await c.get("/memory/topics", params={"grants": "x"}, headers=headers)
        assert resp.status_code == 503
