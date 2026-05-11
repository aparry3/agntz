// ═══════════════════════════════════════════════════════════════════════
// agntz — TypeScript SDK for AI Agents
// ═══════════════════════════════════════════════════════════════════════

// Core API
export { createRunner, Runner } from "./runner.js";
export { defineAgent } from "./agent.js";
export { defineTool, ToolRegistry } from "./tool.js";
export { InMemoryRunRegistry } from "./run-registry.js";
export type { RunExecutor, InMemoryRunRegistryOptions } from "./run-registry.js";
export {
  createSpawnAgentTool,
  createCheckAgentsTool,
  resolveSpawnable,
  DEFAULT_SPAWN_LIMITS,
} from "./tools/spawn-agent.js";
export type { SpawnLimits, SpawnableEntry } from "./tools/spawn-agent.js";

// Stores
export { MemoryStore } from "./stores/memory.js";
export { JsonFileStore } from "./stores/json-file.js";

// Model Provider
export { AISDKModelProvider } from "./model-provider.js";

// MCP
export { MCPClientManager } from "./mcp/client-manager.js";
export type { MCPTool } from "./mcp/client-manager.js";
export { createMCPServer } from "./mcp/server.js";
export type { MCPServerOptions } from "./mcp/server.js";
export { listToolsOnServer } from "./mcp/list-tools.js";
export type { ListToolsOptions } from "./mcp/list-tools.js";
export { resolveMCPServer } from "./mcp/resolve-server.js";
export type { ResolvedMCPServer } from "./mcp/resolve-server.js";

// Telemetry
export { Telemetry } from "./telemetry.js";
export type {
  TelemetryConfig,
  OTelTracer,
  OTelSpan,
  InvokeSpan,
  ModelCallSpan,
  ToolCallSpan,
} from "./telemetry.js";

// Utilities
export { withRetry } from "./utils/retry.js";
export type { RetryConfig } from "./utils/retry.js";
export { summarizeMessages, trimHistoryWithSummary } from "./utils/summarize.js";

// Eval
export { runEval } from "./eval.js";
export type { AssertionResult, EvalRunOptions, CustomAssertionFn } from "./eval.js";
export { runEvalSuite } from "./eval-suite.js";
export type { EvalSuiteRunOptions } from "./eval-suite.js";

// Errors
export {
  AgntzError,
  AgentNotFoundError,
  ToolNotFoundError,
  ToolExecutionError,
  ModelError,
  ProviderNotFoundError,
  InvocationCancelledError,
  MaxStepsExceededError,
  MaxRecursionDepthError,
  RetryExhaustedError,
  ValidationError,
} from "./errors.js";

// Types
export type {
  // Agent
  AgentDefinition,
  AgentRef,
  ModelConfig,

  // Tools
  ToolDefinition,
  ToolReference,
  ToolContext,
  ToolInfo,

  // Invocation
  InvokeOptions,
  InvokeResult,
  InvokeStream,
  StreamEvent,
  ToolCallRecord,
  TokenUsage,

  // Messages & Sessions
  Message,
  SessionSummary,

  // Context
  ContextEntry,

  // Logs
  InvocationLog,
  LogFilter,

  // Evaluation
  EvalConfig,
  EvalTestCase,
  EvalAssertion,
  EvalResult,
  EvalSuiteAssertionType,
  EvalSuiteAssertion,
  EvalSuiteCase,
  EvalSuite,
  EvalSuiteRunStatus,
  EvalSuiteAssertionResult,
  EvalSuiteCaseResult,
  EvalSuiteRunSummary,
  EvalSuiteRun,

  // Configuration
  RunnerConfig,
  MCPServerConfig,

  // Store Interfaces
  AgentStore,
  AgentVersionSummary,
  SessionStore,
  ContextStore,
  LogStore,
  EvalSuiteStore,
  ProviderStore,
  ProviderConfig,
  ConnectionStore,
  Connection,
  ConnectionKind,
  ConnectionConfig,
  MCPConnectionConfig,
  ApiKeyStore,
  ApiKeyRecord,
  ScopableStore,
  UnifiedStore,

  // Runs
  Run,
  RunStatus,
  RunHandle,
  RunStore,
  RunRegistry,
  PendingChildResult,
  MultiplexedEvent,
  SpawnRunOptions,

  // Model Provider
  ModelProvider,
  ModelStreamResult,
  GenerateTextOptions,
  GenerateTextResult,
} from "./types.js";
