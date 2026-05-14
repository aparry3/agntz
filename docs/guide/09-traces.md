# Traces

A **trace** is a tree of `Span`s capturing the execution of one agent invocation — every model call, every tool execution, every nested step. Traces are the "what actually happened" view: the inputs and outputs are in Runs and Sessions, but how the model spent its tokens and where the time went live in Traces.

> Traces are the agntz-internal observability system. They are **separate** from the [OpenTelemetry export](/guide/21-telemetry) — you can use both, but you don't need OTel to see traces in the App. The trace store is on by default; OTel is opt-in.

## The data model

```
Trace                                  (a set of Spans sharing one traceId)
└── Span (kind: "run", name: "researcher")
    ├── Span (kind: "manifest")
    │   ├── Span (kind: "step", name: "fetch")
    │   │   ├── Span (kind: "invoke")
    │   │   │   ├── Span (kind: "model")   ← LLM call
    │   │   │   └── Span (kind: "tool")    ← tool execution
    │   └── Span (kind: "step", name: "summarize")
    │       └── Span (kind: "invoke")
    │           └── Span (kind: "model")
```

Spans form a tree via `parentId`. The whole tree shares a `traceId`. A `TraceSummary` rolls the tree up into a single record for fast list views.

## Span

```typescript
// packages/core/src/types.ts:715-734
interface Span {
  spanId: string;
  traceId: string;
  parentId: string | null;
  /** Tenant scoping — same value as `userId` elsewhere */
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: string;        // ISO 8601
  endedAt: string | null;
  durationMs: number | null;
  status: SpanStatus;        // "running" | "ok" | "error" | "cancelled"
  error: string | null;
  attributes: Record<string, unknown>;
  events: Array<{ ts: string; name: string; data?: unknown }>;
  scores: Record<string, { value: number; reason?: string }>;
  costUsd: number | null;
}

type SpanKind = "run" | "manifest" | "step" | "invoke" | "model" | "tool";
```

| `SpanKind` | Emitted by | What it wraps |
|---|---|---|
| `run` | `RunRegistry` | The full lifecycle of one Run record |
| `manifest` | `@agntz/manifest` executor | One top-level manifest execution |
| `step` | sequential/parallel pipeline | One step inside a manifest |
| `invoke` | `runner.invoke()` | One call into the agent loop |
| `model` | `AISDKModelProvider` | One LLM API call (one iteration of the loop) |
| `tool` | `ToolRegistry` | One tool execution |

## TraceSummary

Precomputed roll-up powering list views without scanning every span (`packages/core/src/types.ts:741-753`):

```typescript
interface TraceSummary {
  traceId: string;
  ownerId: string;
  rootName: string;
  agentId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  spanCount: number;
  status: SpanStatus;
  totalTokens: number;
  totalCostUsd: number | null;
}
```

The registry maintains this incrementally — `upsertSummary` is called on trace start, on every span end (to update token totals and `endedAt` if the trace just terminated), and on `trace-done`.

## Span emission

Span emission is driven by the per-invocation `SpanEmitter` (`packages/core/src/types.ts:175-181` for `InvokeOptions.spanEmitter`). The worker creates one per `/run` or `/runs` request and threads it through to the runner and the manifest executor. The emitter has its own internal span stack — child spans nest under whatever span is at the top.

When a span starts or ends, the emitter calls a `TraceSink` callback:

```typescript
// packages/core/src/types.ts:769-778
type TraceLiveEvent =
  | { type: "span-start"; span: Span }
  | { type: "span-end"; spanId: string; patch: Partial<Span> }
  | { type: "trace-done"; summary: TraceSummary };

type TraceSink = (event: TraceLiveEvent) => void;
```

In the worker, the sink is wired to `InMemoryTraceRegistry` (`packages/worker/src/trace-registry.ts`) which:

1. Batches `insertSpan` / `updateSpan` writes to `TraceStore`.
2. Maintains in-memory `Span[]` per in-progress trace for live SSE subscribers.
3. Multiplexes `TraceLiveEvent`s out to subscribers so the App's trace UI can render spans as they happen.

## TraceStore

Persistence interface (`packages/core/src/types.ts:784-795`):

```typescript
interface TraceStore {
  insertSpan(span: Span): Promise<void>;
  insertSpansBatch(spans: Span[]): Promise<void>;
  updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void>;
  upsertSummary(summary: TraceSummary): Promise<void>;
  getTrace(traceId: string, ownerId: string): Promise<Span[]>;
  getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null>;
  listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }>;
  deleteTrace(traceId: string, ownerId: string): Promise<void>;
  /** Returns the number of traces (not spans) deleted */
  deleteOlderThan(ownerId: string, before: Date): Promise<number>;
}
```

`ownerId` is required on every read and is stamped on every write — there is no unscoped read path. `UnifiedStore` includes `TraceStore`, so the same store backing your agents, sessions, and runs also backs traces. `PostgresStore` ships a production implementation; `MemoryStore` is in-process.

## The HTTP surface

The worker exposes `/traces/*` under `packages/worker/src/routes.ts:441-505`:

| Method + Path | Purpose |
|---|---|
| `GET /traces` | List `TraceSummary` for the current user with filters: `agentId`, `status`, `startedAfter`, `startedBefore`, `limit`, `cursor` |
| `GET /traces/:id` | Fetch one trace — returns `{ summary, spans }` |
| `GET /traces/:id/stream` | SSE stream of `TraceLiveEvent` while the trace is in progress. If the trace already completed, returns a one-shot snapshot |
| `DELETE /traces/:id` | Delete the trace and all its spans |

`TraceFilter` (`packages/core/src/types.ts:755-763`):

```typescript
interface TraceFilter {
  ownerId: string;          // set by the route, not the client
  agentId?: string;
  status?: SpanStatus;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;           // default 50, max 200
  cursor?: string;          // opaque; encodes (startedAt, traceId)
}
```

Cursor pagination uses base64url JSON `{ startedAt, traceId }` for stable ordering even when many traces share the same timestamp.

## The SDK surface

`@agntz/sdk`'s `TracesResource` (`packages/sdk/src/client.ts:189-240`):

```typescript
import { AgntzClient } from "@agntz/sdk";

const client = new AgntzClient({ apiKey, baseUrl });

// List recent traces
const { rows, cursor } = await client.traces.list({ limit: 50 });

// Fetch one
const { summary, spans } = await client.traces.get(traceId);

// Watch live
for await (const event of client.traces.stream(traceId)) {
  if (event.type === "span-start") console.log("→", event.span.name);
  if (event.type === "span-end") console.log("✓", event.spanId);
  if (event.type === "trace-done") break;
}

await client.traces.delete(traceId);
```

## Trace, Run, and Span relationships

- One Run → one trace. The root span has `kind: "run"`, `runId = run.id`, `name = agentId`.
- A spawned child Run gets its own root span — under the same `traceId` as its parent's run span — via the child's own SpanEmitter (`packages/core/src/types.ts:603-606`).
- `Span.runId` lets you filter spans to one Run within a trace. `Span.sessionId` lets you cross-reference traces and conversations.

```
traceId: trace_abc
├── runId: run_root        kind: "run"       name: "orchestrator"
│   ├── runId: run_root    kind: "model"
│   ├── runId: run_root    kind: "tool"      name: "spawn_agent"
│   ├── runId: run_child1  kind: "run"       name: "researcher"
│   │   └── runId: run_child1  kind: "model"
│   └── runId: run_child2  kind: "run"       name: "summarizer"
│       └── runId: run_child2  kind: "model"
```

## Privacy

The worker constructs each `SpanEmitter` with `recordIO: false` by default (`packages/worker/src/routes.ts:179, 219`). Span attributes do not contain raw user input or model output text — only metadata like token counts, durations, finish reasons, tool names, and error messages.

If you build a custom telemetry path that needs content, flip `recordIO: true` and accept that span attributes will contain prompts and completions truncated to 4KB.

## Traces vs. OpenTelemetry

The OTel integration ([chapter 21](/guide/21-telemetry)) and the in-app trace store are independent:

| | In-app traces | OpenTelemetry |
|---|---|---|
| Storage | `TraceStore` (Postgres/memory) | Whatever OTel collector you ship to |
| Access | App `/traces` UI, `@agntz/sdk` | Jaeger, Honeycomb, Datadog, etc. |
| Schema | `Span` (this chapter) | OTel `Span` |
| Off by default? | No — always on if a `TraceStore` is configured | Yes — opt-in via `RunnerConfig.telemetry` |
| Privacy default | `recordIO: false` | `recordIO: false` |

Use the in-app traces for product observability (debugging in the dashboard) and OTel for fleet observability (cross-service tracing). Both can run simultaneously — the emitter dispatches to all configured sinks.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/core/src/types.ts:704-795` | `Span`, `TraceSummary`, `TraceFilter`, `TraceLiveEvent`, `TraceStore` |
| `packages/core/src/telemetry.ts` | `SpanEmitter` |
| `packages/worker/src/trace-registry.ts` | `InMemoryTraceRegistry` — batching + live subscriptions |
| `packages/worker/src/routes.ts:441-505` | `/traces/*` HTTP routes |
| `packages/sdk/src/client.ts:189-240` | `TracesResource` SDK |
