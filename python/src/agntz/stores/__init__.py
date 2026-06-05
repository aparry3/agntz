"""Store implementations for the Python SDK."""

from .memory import (
    LocalMessageRecord,
    LocalRunRecord,
    LocalSessionSummary,
    LocalTraceRecord,
    LocalTraceSpanRecord,
    MemoryStore,
    RunStore,
)
from .sqlite import SQLiteStore

try:
    from .postgres import PostgresStore
except Exception:  # pragma: no cover - postgres extra may be absent.
    PostgresStore = None  # type: ignore[assignment]

__all__ = [
    "LocalMessageRecord",
    "LocalRunRecord",
    "LocalSessionSummary",
    "LocalTraceRecord",
    "LocalTraceSpanRecord",
    "MemoryStore",
    "PostgresStore",
    "RunStore",
    "SQLiteStore",
]
