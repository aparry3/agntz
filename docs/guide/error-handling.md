# Error Handling & Retry

## Typed Errors

agntz provides specific error types for common failures:

```typescript
import {
  AgntzError,
  AgentNotFoundError,
  ToolNotFoundError,
  ToolExecutionError,
  MaxStepsExceededError,
  MaxRecursionDepthError,
  ModelError,
  ProviderNotFoundError,
  InvocationCancelledError,
  RetryExhaustedError,
  ValidationError,
  SkillNotFoundError,
} from "agntz";

try {
  await runner.invoke("nonexistent", "Hello");
} catch (err) {
  if (err instanceof AgentNotFoundError) {
    console.log(`Agent not found: ${err.agentId}`);
  }
  // Or catch the base class
  if (err instanceof AgntzError) {
    console.log(err.code);  // typed error code (e.g. "AGENT_NOT_FOUND")
  }
}

## Error Types

All errors extend `AgntzError` with a typed `code`. The full set (`packages/core/src/errors.ts`):

| Class | Code | When thrown |
|---|---|---|
| `AgentNotFoundError` | `AGENT_NOT_FOUND` | Agent ID not registered or in store |
| `ToolNotFoundError` | `TOOL_NOT_FOUND` | Tool name not in registry |
| `ToolExecutionError` | `TOOL_EXECUTION_ERROR` | Tool's `execute()` threw |
| `ModelError` | `MODEL_ERROR` | Provider returned an error |
| `ProviderNotFoundError` | `PROVIDER_NOT_FOUND` | Unknown `model.provider` |
| `InvocationCancelledError` | `INVOCATION_CANCELLED` | `AbortSignal` aborted |
| `MaxStepsExceededError` | `MAX_STEPS_EXCEEDED` | Agent loop hit `maxSteps` (default 10) |
| `MaxRecursionDepthError` | `MAX_RECURSION_DEPTH` | Agent-as-tool chain exceeded `maxRecursionDepth` (default 3) |
| `RetryExhaustedError` | `RETRY_EXHAUSTED` | All retry attempts failed |
| `ValidationError` | `VALIDATION_ERROR` | Agent definition validation failed |
| `SkillNotFoundError` | `SKILL_NOT_FOUND` | Skill name not in `SkillStore` |
```

## Retry Configuration

Configure automatic retry with exponential backoff for transient failures:

```typescript
const runner = createRunner({
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffMultiplier: 2,
    retryableErrors: ["rate_limit", "timeout", "5xx"],
  },
});
```

Retry applies to model API calls — tool execution errors are not retried (tools may have side effects).

## Graceful Shutdown

```typescript
const runner = createRunner({ ... });

// Clean up on process exit
process.on("SIGTERM", async () => {
  await runner.shutdown();
  // Closes MCP connections, flushes stores
  process.exit(0);
});
```

`shutdown()` is idempotent, error-resilient, and runs cleanup in parallel.
