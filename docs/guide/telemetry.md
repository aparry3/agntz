# OpenTelemetry

agntz has built-in OpenTelemetry integration for observability. It's completely opt-in — zero overhead when not configured.

## Setup

Install `@opentelemetry/api` (and your preferred exporter):

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

Pass your tracer to `createRunner()`:

```typescript
import { createRunner } from "agntz";
import { trace } from "@opentelemetry/api";

const runner = createRunner({
  telemetry: {
    tracer: trace.getTracer("my-app"),
  },
});
```

Or let agntz use the global tracer (if you've configured the OTel SDK globally):

```typescript
const runner = createRunner({
  telemetry: {
    tracerName: "my-app", // Uses trace.getTracer("my-app") from @opentelemetry/api
  },
});
```

## Configuration

```typescript
interface TelemetryConfig {
  /** An OpenTelemetry Tracer instance */
  tracer?: Tracer;
  /** Tracer name for global lookup (default: "agntz") */
  tracerName?: string;
  /** Record input/output in span attributes (default: false for privacy) */
  recordIO?: boolean;
  /** Record tool call inputs/outputs (default: false) */
  recordToolIO?: boolean;
  /** Custom attributes added to every span */
  baseAttributes?: Record<string, string | number | boolean>;
}
```

## Span Hierarchy

Every `runner.invoke()` call produces this span tree:

```
agent.invoke                          ← Root span
├── agent.model.call (step 1)         ← First LLM API call
├── agent.tool.execute (lookup_order) ← Tool execution
├── agent.model.call (step 2)         ← Second LLM API call (after tool result)
└── ...
```

### `agent.invoke` Attributes

| Attribute | Type | Description |
|---|---|---|
| `agent.id` | string | Agent ID |
| `agent.invocation.id` | string | Unique invocation ID |
| `agent.model` | string | Model used (e.g., `openai/gpt-5.4`) |
| `agent.session.id` | string | Session ID (if set) |
| `agent.context.ids` | string | Comma-separated context IDs |
| `agent.usage.prompt_tokens` | number | Total prompt tokens |
| `agent.usage.completion_tokens` | number | Total completion tokens |
| `agent.usage.total_tokens` | number | Total tokens |
| `agent.duration_ms` | number | Total invocation time (ms) |
| `agent.tool_call_count` | number | Number of tool calls |
| `agent.step_count` | number | Number of model call steps |
| `agent.input` | string | User input (only if `recordIO: true`) |
| `agent.output` | string | Agent output (only if `recordIO: true`) |

### `agent.model.call` Attributes

| Attribute | Type | Description |
|---|---|---|
| `agent.model` | string | Model used |
| `agent.step` | number | Step number in the loop |
| `agent.usage.*` | number | Token usage for this call |
| `agent.finish_reason` | string | Model finish reason |
| `agent.tool_call_count` | number | Tool calls requested |

### `agent.tool.execute` Attributes

| Attribute | Type | Description |
|---|---|---|
| `agent.tool.name` | string | Tool name |
| `agent.tool.call.id` | string | Tool call ID |
| `agent.tool.duration_ms` | number | Execution time (ms) |
| `agent.tool.error` | string | Error message (if failed) |
| `agent.tool.input` | string | Tool input JSON (only if `recordToolIO: true`) |
| `agent.tool.output` | string | Tool output JSON (only if `recordToolIO: true`) |

## Privacy

By default, **no input/output content is recorded** in spans. This is intentional — agent interactions often contain sensitive user data.

Enable content recording only in development or when you have appropriate data handling:

```typescript
const runner = createRunner({
  telemetry: {
    tracer: myTracer,
    recordIO: true,       // Record agent input/output
    recordToolIO: true,   // Record tool input/output
  },
});
```

Content is truncated to 4KB to prevent excessive span sizes.

## Example: Jaeger Export

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { trace } from "@opentelemetry/api";

// Initialize OTel SDK
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  serviceName: "my-agent-app",
});
sdk.start();

// Use with agntz
const runner = createRunner({
  telemetry: {
    tracer: trace.getTracer("my-agent-app"),
    baseAttributes: {
      "service.version": "1.0.0",
      "deployment.environment": "production",
    },
  },
});
```

## Zero Overhead

When telemetry is not configured, all span operations are no-ops — empty function calls that get optimized away. There's no performance penalty for having the telemetry code path in the SDK.
