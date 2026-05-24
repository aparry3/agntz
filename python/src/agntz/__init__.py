"""Python SDK and hosted client for Agntz."""

from .client import (
    AgntzClient,
    AgntzError,
    AsyncAgntzClient,
    AuthenticationError,
    NotFoundError,
    StreamError,
)
from .core import GenerateTextResult, ModelProvider, ToolDefinition, tool
from .sdk import LocalClient, agntz

__all__ = [
    "__version__",
    "AgntzClient",
    "AgntzError",
    "AsyncAgntzClient",
    "AuthenticationError",
    "GenerateTextResult",
    "LocalClient",
    "ModelProvider",
    "NotFoundError",
    "StreamError",
    "ToolDefinition",
    "agntz",
    "tool",
]

__version__ = "0.1.0"
