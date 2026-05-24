export default `# Runs and traces

Every invocation produces a **Run** (the top-level execution record) and a **Trace** (the span tree below it).

A trace's spans cover three kinds of work:

- \`agent.invoke\` or \`run\` — the root span for an agent run.
- \`model.call\` or \`model\` — each LLM API call.
- \`tool.execute\` or \`tool\` — each tool execution.

Spans nest. A sequential pipeline's trace looks like:

\`\`\`
agent.invoke article-pipeline
├── agent.invoke research-phase   (parallel)
│   ├── agent.invoke web-researcher
│   │   └── model.call gpt-5.4
│   └── agent.invoke academic-researcher
│       └── model.call gpt-5.4
└── agent.invoke write-review
    ├── agent.invoke writer
    │   └── model.call claude-sonnet-4-6
    └── agent.invoke editor
        └── model.call gpt-5.4-mini
\`\`\`

## Listing and inspecting

\`\`\`ts {group=runs-list}
const { rows } = await client.runs.list({
  agentId: "support-agent",
  status: "error",
  limit: 50,
});

const trace = await client.traces.get(rows[0].id);
for (const span of trace.spans) {
  console.log(span.kind, span.name, span.durationMs, span.status);
}
\`\`\`

\`\`\`python {group=runs-list}
runs = client.runs.list(
    agent_id="support-agent",
    status="completed",
)

trace_rows = client.traces.list(agent_id="support-agent")
trace = client.traces.get(trace_rows["rows"][0]["traceId"])
for span in trace["spans"]:
    print(span["kind"], span["name"], span["durationMs"], span["status"])
\`\`\`

The resource shape is intentionally similar across local and hosted clients. TypeScript uses camelCase option names; Python uses snake_case.

## Live trace streams

\`\`\`ts {group=runs-stream}
for await (const event of client.traces.stream(runId)) {
  if (event.type === "span-start") console.log("→", event.span.name);
  if (event.type === "span-end") console.log("←", event.span.name, event.span.durationMs);
}
\`\`\`

\`\`\`python {group=runs-stream}
for event in client.traces.stream(trace_id):
    if event.type == "snapshot":
        print(event.summary)
\`\`\`

The hosted Python client streams worker SSE events. The local Python SDK currently exposes trace snapshots rather than token-level span updates.

## Storage

### Embedded

Runs and traces live in memory by default. For durable storage, use SQLite:

\`\`\`ts {group=runs-store}
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});
\`\`\`

\`\`\`python {group=runs-store}
from agntz import LiteLLMModelProvider, SQLiteStore, agntz

client = agntz(
    agents="./agents",
    store=SQLiteStore("./agntz.db"),
    model_provider=LiteLLMModelProvider(),
)
\`\`\`

The same store backs sessions, messages, runs, and trace spans.

### Hosted

Runs and traces are written to Postgres, scoped to the authenticated user. No eviction.

## OpenTelemetry

TypeScript embedded runs can pipe spans into an existing observability stack:

\`\`\`ts
import { trace } from "@opentelemetry/api";
import { createRunner } from "@agntz/sdk";

const runner = createRunner({
  telemetry: {
    tracer: trace.getTracer("my-app"),
    recordIO: false,
    recordToolIO: false,
    baseAttributes: {
      "service.name": "my-app",
      "deployment.environment": "production",
    },
  },
});
\`\`\`

Python local trace spans are stored through the configured Agntz store in this first package slice. OpenTelemetry export can be added on top of that store protocol later.

## Cancellation

Hosted and TypeScript long-running runs are cancellable:

\`\`\`ts {group=runs-cancel}
const run = await client.runs.start({ agentId: "long-job", input: {} });
await client.runs.cancel(run.id);
\`\`\`

\`\`\`python {group=runs-cancel}
run = client.runs.start(agent_id="long-job", input={})
client.runs.cancel(run.id)
\`\`\`

Cancellation is best-effort: in-flight model calls finish, but no further steps execute and cancellation propagates through nested pipelines.
`;
