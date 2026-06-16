"""Shared database plumbing for agntz's stores.

Lazy driver loading and connection construction shared by the core stores
(``ar_*`` tables) and the memrez stores (``memrez_*`` tables). Postgres support
is an optional extra (``psycopg``); SQLite uses the standard library. Each store
still owns its own schema (its ``_migrate``), table names, and queries — only
the connection plumbing lives here.

This mirrors the TypeScript ``@agntz/db`` package. It is intentionally thinner:
the Python stores use a single synchronous connection (no pool) and run their
idempotent ``CREATE TABLE IF NOT EXISTS`` migrations in ``__init__``, so there
is no connection pool or migration-promise lifecycle to share.
"""

from __future__ import annotations

import importlib
import sqlite3
from pathlib import Path
from typing import Any


def load_psycopg() -> Any:
    """Import ``psycopg`` lazily, with a consistent install hint when missing."""
    try:
        return importlib.import_module("psycopg")
    except (ImportError, ModuleNotFoundError) as exc:
        raise RuntimeError(
            "Postgres support requires psycopg. Install the extra: "
            "pip install 'agntz[postgres]' (or psycopg[binary]>=3.2.0)."
        ) from exc


def load_jsonb() -> Any:
    """The psycopg ``Jsonb`` adapter used to bind JSONB column values."""
    return importlib.import_module("psycopg.types.json").Jsonb


def connect_postgres(dsn: str, *, autocommit: bool = True, row_factory: Any = None) -> Any:
    """Open a psycopg connection with agntz's standard settings (autocommit on)."""
    psycopg = load_psycopg()
    kwargs: dict[str, Any] = {"autocommit": autocommit}
    if row_factory is not None:
        kwargs["row_factory"] = row_factory
    return psycopg.connect(dsn, **kwargs)


def connect_sqlite(path: str | Path, *, check_same_thread: bool = True) -> sqlite3.Connection:
    """Open a sqlite3 connection with row access by column name."""
    conn = sqlite3.connect(path, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    return conn
