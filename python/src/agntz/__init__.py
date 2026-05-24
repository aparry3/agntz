"""Python SDK and hosted client for Agntz."""

from .client import (
    AgntzClient,
    AgntzError,
    AsyncAgntzClient,
    AuthenticationError,
    NotFoundError,
    StreamError,
)
from .core import (
    GenerateTextResult,
    LiteLLMModelProvider,
    ModelMessage,
    ModelProvider,
    ModelTool,
    ToolCall,
    ToolDefinition,
    ToolResult,
    tool,
)
from .sdk import LocalClient, agntz
from .stores import (
    LocalMessageRecord,
    LocalSessionSummary,
    LocalTraceSpanRecord,
    MemoryStore,
    SQLiteStore,
)

__all__ = [
    "__version__",
    "AgntzClient",
    "AgntzError",
    "AsyncAgntzClient",
    "AuthenticationError",
    "GenerateTextResult",
    "LiteLLMModelProvider",
    "LocalClient",
    "LocalMessageRecord",
    "LocalSessionSummary",
    "LocalTraceSpanRecord",
    "ModelMessage",
    "ModelProvider",
    "ModelTool",
    "MemoryStore",
    "NotFoundError",
    "SQLiteStore",
    "StreamError",
    "ToolCall",
    "ToolDefinition",
    "ToolResult",
    "agntz",
    "tool",
]

__version__ = "0.1.0"
