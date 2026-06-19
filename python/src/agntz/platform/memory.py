"""In-memory hosted-platform store."""

from __future__ import annotations

from agntz.stores.memory import MemoryStore


class PlatformMemoryStore(MemoryStore):
    """Hosted-capable in-memory store.

    The implementation currently reuses ``MemoryStore`` because Python keeps the
    package in one distribution. The named class gives hosted code a platform
    boundary that mirrors TypeScript's ``@agntz/platform/memory``.
    """


__all__ = ["PlatformMemoryStore"]
