"""Python SDK and hosted client for Agntz."""

from .client import (
    AgntzClient,
    AgntzError,
    AsyncAgntzClient,
    AuthenticationError,
    NotFoundError,
    StreamError,
)
from .context import (
    NamespaceGrantError,
    NamespaceGrantPolicy,
    ProtectedNamespaceRule,
    normalize_namespace_grant,
    normalize_namespace_grants,
    validate_namespace_grant_policy,
)
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
from .memrez_postgres import PostgresMemoryStore, PostgresMemoryStoreOptions
from .memrez_provider import MemoryResourceProvider, create_memory_resource_provider
from .memrez_reasoner import AgntzReasoner, agntz_reasoner, memrez_agents_path
from .memrez_sqlite import SqliteMemoryStore, SqliteMemoryStoreOptions
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
    "AgntzReasoner",
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
    "NamespaceGrantPolicy",
    "NotFoundError",
    "PostgresMemoryStore",
    "PostgresMemoryStoreOptions",
    "ProtectedNamespaceRule",
    "ResourceProvider",
    "ResourceProviderToolDefinition",
    "ResourceRegistrationContext",
    "ResourceToolContext",
    "SQLiteStore",
    "SqliteMemoryStore",
    "SqliteMemoryStoreOptions",
    "StreamError",
    "ToolCall",
    "ToolDefinition",
    "ToolResult",
    "agntz",
    "agntz_reasoner",
    "create_memory_resource_provider",
    "create_memrez",
    "memrez_agents_path",
    "normalize_namespace_grant",
    "normalize_namespace_grants",
    "validate_namespace_grant_policy",
    "tool",
]

__version__ = "0.1.0"
