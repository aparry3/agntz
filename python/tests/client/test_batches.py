from __future__ import annotations

import json

import httpx

from agntz import AgntzClient


def _run_payload(run_id: str = "batchrun_1") -> dict[str, object]:
    return {
        "id": run_id,
        "batchId": "summaries",
        "batchVersion": "2026-07-29T12:00:00.000Z",
        "datasetId": "customers",
        "datasetVersion": "2026-07-29T12:00:01.000Z",
        "provider": "openai",
        "model": "gpt-5.4-mini",
        "status": "queued",
        "counts": {
            "total": 2,
            "pending": 2,
            "succeeded": 0,
            "failed": 0,
            "expired": 0,
            "cancelled": 0,
        },
        "snapshot": {"batch": {"id": "summaries"}},
        "createdAt": "2026-07-29T12:00:02.000Z",
    }


def test_batches_run_sends_version_pins_and_idempotency_header() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/batch-runs"
        assert request.headers["idempotency-key"] == "run-once"
        assert json.loads(request.content) == {
            "batchId": "summaries",
            "batchVersion": "baseline",
            "datasetId": "customers",
            "datasetVersion": "production",
        }
        return httpx.Response(201, json=_run_payload())

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )

    run = client.batches.run(
        batch_id="summaries",
        batch_version="baseline",
        dataset_id="customers",
        dataset_version="production",
        idempotency_key="run-once",
    )

    assert run.id == "batchrun_1"
    assert run.dataset_version == "2026-07-29T12:00:01.000Z"


def test_batches_manage_versions_aliases_and_terminal_runs() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "DELETE":
            return httpx.Response(204)
        if "/aliases/" in request.url.path:
            return httpx.Response(
                200,
                json={
                    "alias": "good / baseline",
                    "version": "2026-07-29T12:00:00.000Z",
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "summary / batch",
                "manifest": "id: summaries\nkind: llm\n",
                "provider": "openai",
                "model": "gpt-5.4-mini",
            },
        )

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    batch_id = "summary / batch"
    version = "2026-07-29T12:00:00.000Z"
    alias = "good / baseline"

    client.batches.get_version(batch_id, version)
    client.batches.activate_version(batch_id, version)
    assert client.batches.set_alias(batch_id, alias, version) == {
        "alias": alias,
        "version": version,
    }
    client.batches.remove_alias(batch_id, alias)
    client.batches.delete_run("run / one")

    assert [(request.method, request.url.raw_path.decode()) for request in seen] == [
        (
            "GET",
            "/batches/summary%20%2F%20batch/versions/2026-07-29T12%3A00%3A00.000Z",
        ),
        (
            "POST",
            "/batches/summary%20%2F%20batch/versions/2026-07-29T12%3A00%3A00.000Z/activate",
        ),
        (
            "PUT",
            "/batches/summary%20%2F%20batch/aliases/good%20%2F%20baseline",
        ),
        (
            "DELETE",
            "/batches/summary%20%2F%20batch/aliases/good%20%2F%20baseline",
        ),
        ("DELETE", "/batch-runs/run%20%2F%20one"),
    ]
    assert json.loads(seen[2].content) == {"version": version}


def test_dataset_csv_import_uses_staged_api() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/dataset-imports":
            return httpx.Response(
                201,
                json={
                    "id": "import_1",
                    "datasetId": "customers",
                    "name": "Customers",
                    "status": "open",
                    "itemCount": 0,
                    "createdAt": "2026-07-29T12:00:00.000Z",
                    "updatedAt": "2026-07-29T12:00:00.000Z",
                },
            )
        if request.url.path.endswith("/items"):
            return httpx.Response(200, json={"itemCount": 2})
        return httpx.Response(
            200,
            json={
                "id": "customers",
                "name": "Customers",
                "items": [],
                "itemCount": 2,
                "version": "2026-07-29T12:00:01.000Z",
            },
        )

    client = AgntzClient(
        api_key="test-key",
        base_url="https://worker.test",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    dataset = client.datasets.import_(
        "id,input,segment\ncustomer_1,Ada,enterprise\ncustomer_2,Grace,smb",
        format="csv",
        dataset_id="customers",
        name="Customers",
    )

    assert dataset.item_count == 2
    assert [request.url.path for request in seen] == [
        "/dataset-imports",
        "/dataset-imports/import_1/items",
        "/dataset-imports/import_1/complete",
    ]
    assert json.loads(seen[1].content) == {
        "items": [
            {
                "id": "customer_1",
                "input": "Ada",
                "metadata": {"segment": "enterprise"},
            },
            {
                "id": "customer_2",
                "input": "Grace",
                "metadata": {"segment": "smb"},
            },
        ]
    }
