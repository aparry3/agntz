export default `# Runs and traces

Every invocation produces a **Run** (the top-level execution record) and a **Trace** (the span tree below it).

A trace's spans cover three kinds of work:

- \`agent.invoke\` — the root span for an agent run (and one per sub-agent).
- \`model.call\` — each LLM API call (usage, finish reason, latency).
- \`tool.execute\` — each tool execution (tool name, duration, errors).

Spans nest. A sequential pipeline's trace looks like:

\`\`\`
agent.invoke article-pipeline
├── agent.invoke research-phase   (parallel)
│   ├── agent.invoke web-researcher
│   │   └── model.call gpt-5.4
│   └── agent.invoke academic-researcher
│       └── model.call gpt-5.4
└── agent.invoke write-review     (loop, 2 iterations)
    ├── agent.invoke writer
    │   └── model.call claude-sonnet-4-6
    └── agent.invoke editor
        └── model.call gpt-5.4-mini
\`\`\`

## Listing and inspecting

\`\`\`ts
// List recent runs
const { rows } = await client.runs.list({
  agentId: "support-agent",
  status: "error",
  limit: 50,
});

// Drill into one
const trace = await client.traces.get(rows[0].id);
for (const span of trace.spans) {
  console.log(span.kind, span.name, span.durationMs, span.status);
}

// Stream live traces as a run executes
for await (const event of client.traces.stream(runId)) {
  if (event.type === "span-start") console.log("→", event.span.name);
  if (event.type === "span-end") console.log("←", event.span.name, event.span.durationMs);
}
\`\`\`

The shape is identical in embedded mode (\`@agntz/sdk\`) and hosted mode (\`@agntz/client\`). Code you wrote against the embedded runner works verbatim against the hosted API once you swap imports.

## Storage

### Embedded

Runs and traces live in an **in-memory ring buffer** (default capacity 1000). When the buffer fills, the oldest run is evicted. For durable storage, install \`@agntz/store-sqlite\` — the same store backs sessions, runs, and traces.

### Hosted

Runs and traces are written to Postgres, scoped to the authenticated user. No eviction.

## OpenTelemetry

If you'd rather pipe agntz spans into your existing observability stack, pass an OTel tracer. Zero overhead when not configured.

\`\`\`ts
import { trace } from "@opentelemetry/api";
import { createRunner } from "@agntz/sdk";

const runner = createRunner({
  telemetry: {
    tracer: trace.getTracer("my-app"),
    recordIO: false,           // don't capture input/output (privacy default)
    recordToolIO: false,
    baseAttributes: {
      "service.name": "my-app",
      "deployment.environment": "production",
    },
  },
});
\`\`\`

Spans are emitted with the standard \`gen_ai.*\` semantic conventions where applicable, plus agntz-specific attributes for agent and tool metadata.

## Cancellation

Every run is cancellable. From code:

\`\`\`ts
const run = await client.runs.start({ agentId: "long-job", input: {} });
// later
await client.runs.cancel(run.id);   // cascades to all descendant runs
\`\`\`

Cancellation is best-effort — in-flight model calls finish, but no further steps execute and the cancel propagates through nested pipelines.
`;
