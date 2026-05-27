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
from .context import NamespaceGrantError, normalize_namespace_grant, normalize_namespace_grants
from .memrez import Memrez, MemrezScopeError, create_memrez
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
    "Memrez",
    "MemrezScopeError",
    "NamespaceGrantError",
    "NotFoundError",
    "SQLiteStore",
    "StreamError",
    "ToolCall",
    "ToolDefinition",
    "ToolResult",
    "agntz",
    "create_memrez",
    "normalize_namespace_grant",
    "normalize_namespace_grants",
    "tool",
]

__version__ = "0.1.0"
