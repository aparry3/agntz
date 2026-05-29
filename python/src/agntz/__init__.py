"""Python SDK and hosted client for Agntz."""

from .client import (
    AgntzClient,
    AgntzError,
    AsyncAgntzClient,
    AuthenticationError,
    NotFoundError,
    StreamError,
)
from .context import NamespaceGrantError, normalize_namespace_grant, normalize_namespace_grants
from .core import (
    GenerateTextResult,
    LiteLLMModelProvider,
    ModelMessage,
    ModelProvider,
    ModelTool,
    ResourceProvider,
    ResourceProviderToolDefinition,
    ResourceRegistrationContext,
    ResourceToolContext,
    ToolCall,
    ToolDefinition,
    ToolResult,
    tool,
)
from .memrez import Memrez, MemrezScopeError, create_memrez
from .memrez_provider import MemoryResourceProvider, create_memory_resource_provider
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
    "MemoryResourceProvider",
    "Memrez",
    "MemrezScopeError",
    "NamespaceGrantError",
    "NotFoundError",
    "ResourceProvider",
    "ResourceProviderToolDefinition",
    "ResourceRegistrationContext",
    "ResourceToolContext",
    "SQLiteStore",
    "StreamError",
    "ToolCall",
    "ToolDefinition",
    "ToolResult",
    "agntz",
    "create_memory_resource_provider",
    "create_memrez",
    "normalize_namespace_grant",
    "normalize_namespace_grants",
    "tool",
]

__version__ = "0.1.0"
