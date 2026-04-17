// ═══════════════════════════════════════════════════════════════════════
// agntz — Typed Errors
// ═══════════════════════════════════════════════════════════════════════

/**
 * Base error for all agntz errors.
 * Catch this to handle any SDK error.
 */
export class AgntzError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgntzError";
    this.code = code;
  }
}

/**
 * Thrown when an agent is not found in registered agents or the store.
 */
export class AgentNotFoundError extends AgntzError {
  readonly agentId: string;

  constructor(agentId: string) {
    super(
      "AGENT_NOT_FOUND",
      `Agent "${agentId}" not found. Register it with runner.registerAgent() or add it to the agent store.`,
    );
    this.name = "AgentNotFoundError";
    this.agentId = agentId;
  }
}

/**
 * Thrown when a tool is not found in the registry.
 */
export class ToolNotFoundError extends AgntzError {
  readonly toolName: string;

  constructor(toolName: string) {
    super(
      "TOOL_NOT_FOUND",
      `Tool "${toolName}" not found in the registry.`,
    );
    this.name = "ToolNotFoundError";
    this.toolName = toolName;
  }
}

/**
 * Thrown when a tool execution fails.
 */
export class ToolExecutionError extends AgntzError {
  readonly toolName: string;

  constructor(toolName: string, cause?: Error) {
    super(
      "TOOL_EXECUTION_ERROR",
      `Tool "${toolName}" execution failed: ${cause?.message ?? "unknown error"}`,
      { cause },
    );
    this.name = "ToolExecutionError";
    this.toolName = toolName;
  }
}

/**
 * Thrown when the model provider returns an error.
 */
export class ModelError extends AgntzError {
  readonly provider: string;
  readonly model: string;

  constructor(provider: string, model: string, message: string, cause?: Error) {
    super(
      "MODEL_ERROR",
      `Model error (${provider}/${model}): ${message}`,
      { cause },
    );
    this.name = "ModelError";
    this.provider = provider;
    this.model = model;
  }
}

/**
 * Thrown when an unknown model provider is specified.
 */
export class ProviderNotFoundError extends AgntzError {
  readonly provider: string;

  constructor(provider: string) {
    super(
      "PROVIDER_NOT_FOUND",
      `Unknown model provider "${provider}". Supported: openai, anthropic, google. For other providers, pass a custom modelProvider to createRunner().`,
    );
    this.name = "ProviderNotFoundError";
    this.provider = provider;
  }
}

/**
 * Thrown when an invocation is cancelled via AbortSignal.
 */
export class InvocationCancelledError extends AgntzError {
  constructor() {
    super("INVOCATION_CANCELLED", "Invocation was cancelled.");
    this.name = "InvocationCancelledError";
  }
}

/**
 * Thrown when the agent execution loop exceeds the max step limit.
 */
export class MaxStepsExceededError extends AgntzError {
  readonly maxSteps: number;
  readonly agentId: string;

  constructor(agentId: string, maxSteps: number) {
    super(
      "MAX_STEPS_EXCEEDED",
      `Agent "${agentId}" exceeded maximum tool call steps (${maxSteps}). This may indicate an infinite loop.`,
    );
    this.name = "MaxStepsExceededError";
    this.agentId = agentId;
    this.maxSteps = maxSteps;
  }
}

/**
 * Thrown when agent-as-tool recursion exceeds the max depth.
 */
export class MaxRecursionDepthError extends AgntzError {
  readonly maxDepth: number;
  readonly agentId: string;

  constructor(agentId: string, maxDepth: number) {
    super(
      "MAX_RECURSION_DEPTH",
      `Agent "${agentId}" exceeded maximum recursion depth (${maxDepth}). This may indicate circular agent-as-tool references.`,
    );
    this.name = "MaxRecursionDepthError";
    this.agentId = agentId;
    this.maxDepth = maxDepth;
  }
}

/**
 * Thrown when a model call fails after all retries are exhausted.
 */
export class RetryExhaustedError extends AgntzError {
  readonly attempts: number;

  constructor(attempts: number, cause?: Error) {
    super(
      "RETRY_EXHAUSTED",
      `Model call failed after ${attempts} attempts: ${cause?.message ?? "unknown error"}`,
      { cause },
    );
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
  }
}

/**
 * Thrown when agent definition validation fails.
 */
export class ValidationError extends AgntzError {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
    this.details = details;
  }
}
