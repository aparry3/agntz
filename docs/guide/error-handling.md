# Error Handling & Retry

## Typed Errors

agntz provides specific error types for common failures:

```typescript
import {
  AgentNotFoundError,
  ToolNotFoundError,
  ToolExecutionError,
  MaxRecursionError,
  ModelError,
} from "agntz";

try {
  await runner.invoke("nonexistent", "Hello");
} catch (err) {
  if (err instanceof AgentNotFoundError) {
    console.log(`Agent not found: ${err.agentId}`);
  }
}
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
