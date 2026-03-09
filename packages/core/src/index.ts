// ═══════════════════════════════════════════════════════════════════════
// agent-runner — TypeScript SDK for AI Agents
// ═══════════════════════════════════════════════════════════════════════

// Core API
export { createRunner, Runner } from "./runner.js";
export { defineAgent } from "./agent.js";
export { defineTool, ToolRegistry } from "./tool.js";

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

// Utilities
export { withRetry } from "./utils/retry.js";
export type { RetryConfig } from "./utils/retry.js";

// Eval
export { runEval } from "./eval.js";
export type { AssertionResult, EvalRunOptions, CustomAssertionFn } from "./eval.js";

// Errors
export {
  AgentRunnerError,
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

  // Configuration
  RunnerConfig,
  MCPServerConfig,

  // Store Interfaces
  AgentStore,
  SessionStore,
  ContextStore,
  LogStore,
  UnifiedStore,

  // Model Provider
  ModelProvider,
  ModelStreamResult,
  GenerateTextOptions,
  GenerateTextResult,
} from "./types.js";
