from __future__ import annotations

from pathlib import Path

from agntz import LocalClient, LocalMemoryResource, agntz, create_memrez
from agntz.memrez import DeterministicReasoner, InMemoryMemoryStore, Memrez


def _memrez() -> Memrez:
    return create_memrez(store=InMemoryMemoryStore(), reasoner=DeterministicReasoner())


def test_local_client_exposes_memory_when_memrez_supplied() -> None:
    memrez = _memrez()
    client = LocalClient(manifests={}, tools={}, model_provider=None, memrez=memrez)

    assert isinstance(client.memory, LocalMemoryResource)
    # memrez is auto-registered as the "memory" resource for agent runs
    assert "memory" in client.resource_providers

    client.memory.scan(["app/u1"])  # smoke: delegates without raising
    client.memory.list(["app/u1"])


def test_local_client_memory_is_none_without_memrez() -> None:
    client = LocalClient(manifests={}, tools={}, model_provider=None)
    assert client.memory is None
    assert "memory" not in client.resource_providers


def test_local_memory_resource_delegates_writes_and_deletes() -> None:
    memrez = _memrez()
    client = LocalClient(manifests={}, tools={}, model_provider=None, memrez=memrez)
    memory = client.memory
    assert memory is not None

    memrez.write(["app/u1"], "remembered fact", topics_hint=["notes"])
    memrez.write(["app/u1/child"], "nested fact", topics_hint=["notes"])

    assert {e.scope for e in memory.list(["app/u1"], include_ancestors=False)} == {"app/u1"}

    result = memory.delete_scope(["app/u1"], "app/u1", recursive=True)
    assert result == {"deleted": 2, "topicMeta": 0, "scope": "app/u1", "recursive": True}
    assert memory.list(["app/u1"]) == []


def test_agntz_factory_threads_memrez(tmp_path: Path) -> None:
    memrez = _memrez()
    client = agntz(agents=str(tmp_path), memrez=memrez)
    assert isinstance(client.memory, LocalMemoryResource)
    assert "memory" in client.resource_providers
