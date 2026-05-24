"""ID helpers shared by the local SDK."""

from __future__ import annotations

import secrets

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-"


def nanoid(size: int = 12) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(size))


def run_id() -> str:
    return f"run_{nanoid()}"


def session_id() -> str:
    return f"sess_{nanoid()}"


def trace_id() -> str:
    return f"trace_{nanoid()}"
