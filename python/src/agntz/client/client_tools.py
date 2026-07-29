"""Public client-tool handler types shared by hosted and embedded SDKs."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ClientToolContext:
    request_id: str
    tool_call_id: str
    run_id: str
    deadline_at: str
    signal: threading.Event | asyncio.Event


ClientToolHandler = Callable[[Any, ClientToolContext], Any]
ClientToolHandlers = Mapping[str, ClientToolHandler]
