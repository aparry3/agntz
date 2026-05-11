# Tracing v1 — Native Observability for agntz

**Status:** draft · awaiting review
**Date:** 2026-05-11
**Owner:** Aaron
**Branch target:** `slice-N-tracing-*` (one branch per slice)

---

## 1. Context

agntz is shipping as a customer-facing service (`agntz.co`). To be a production-ready platform, customers need a way to **see what their agents are doing** — both for debugging failures and for understanding behavior over time. This spec defines a native, multi-tenant tracing surface as a v1 product feature. **Evals are out of scope here**; the schema is designed forward-compatible with online scoring so a later eval feature can attach without breaking changes.

### What already exists

Three overlapping primitives observe runtime behavior today; the design unifies them rather than adding a fourth:

| Primitive | Shape | Where | Limit |
|---|---|---|---|
| `InvocationLog` (`LogStore.log`) | flat row per `runner.invoke()` | `packages/core/src/types.ts:243` | Can't represent nesting (agent-as-tool, parallel branches, manifest steps) |
| `Telemetry` spans | hierarchical OTel spans | `packages/core/src/telemetry.ts` | Ephemeral — exported, never persisted by agntz |
| `Run` / `Subrun` | persistent run hierarchy across multiple invokes | `packages/core/src/run-registry.ts`, `RunStore` | Records *what runs exist*, not the internal execution detail |

Together they record everything we need, but in three places, in three shapes, with no UI reading any of them.

### Why now

PR #19 just shipped a process-wide `RunRegistry` and `/runs/*` HTTP surface. That work establishes the multi-tenant, persistent run model, the SDK resource pattern, and the SSE live-tail pattern. Tracing extends those primitives without inventing new infrastructure shapes. There won't be a cleaner foundation to build on later.

---

## 2. Goals & Non-goals

### Goals

- Customers see every run as a span tree in `agntz.co` (list view → tree view → drill-in).
- Spans become the **canonical event log** for runtime behavior. The `InvocationLog` table folds into a SQL view in v1.1.
- Hierarchical: `run > manifest > [step?] > invoke > {model.call, tool.execute}` with agent-as-tool recursion supported.
- Live tail: in-progress runs stream spans to the UI via SSE.
- Multi-tenant: every span scoped by `ownerId`; cross-tenant reads impossible.
- Pluggable backend: `TraceStore` interface with memory / JSON / sqlite / postgres impls.
- Existing OTel adapter survives as an optional sink for power users who want to forward to Honeycomb/Datadog/etc.

### Non-goals (v1)

- Offline eval test suites driven from trace data — the existing `runner.eval()` continues unchanged; integrating it with the new schema is v1.1.
- Online scoring (LLM-as-judge applied to prod traces). Schema has a `scores` column reserved; consumer is later.
- Content search across span inputs/outputs (requires text indexing infra; defer).
- Cost-and-latency analytics dashboards beyond per-trace totals. Cross-trace aggregations are v1.1.
- Adaptive sampling. v1 records every trace; backpressure under load drops spans rather than sampling proactively.
- Per-trace pinning, customer-configurable retention. v1 uses a deployment-level `TRACE_RETENTION_DAYS` env.

---

## 3. Approach

**One end-to-end product release, four sequential slices**, mirroring the structure of the recent `/runs/*` work (PR #19). Each slice ends in a merged PR with tests passing; no slice is half-finished. The implementation-plan step (next skill) will turn each slice into an executable task list.

| Slice | Scope | Approx. surface |
|---|---|---|
| 1 | `TraceStore` interface + all four backends + `ar_spans` schema + retention sweep | `packages/core`, `packages/store-*` |
| 2 | Span emission refactor: `SpanEmitter` (was `telemetry.ts`), `TraceRegistry`, runner+manifest+RunRegistry integration, async flush, OTel sink survival | `packages/core`, `packages/manifest`, `packages/worker` |
| 3 | HTTP surface (`/traces/*`) + `TracesResource` in SDK | `packages/worker`, `packages/sdk` |
| 4 | `agntz.co` UI: list page, trace detail page (tree + Gantt + drawer), live-tail subscription | `packages/app` |

Rationale (why not phased data-then-UI, why not slim-and-iterate): see the brainstorming transcript. Short version — UI requirements should inform the schema indexes (Slice 1) and the SSE event shape (Slice 2), so building the UI last with the data already frozen is the wrong order. Approach 1 keeps the slices small enough to merge cleanly while letting later slices feed back into earlier ones if necessary.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│           agntz.co APP (Next.js)                                 │
│   /traces (list) · /traces/[id] (tree+detail+live tail)          │
└────────────────────────────┬────────────────────────────────────┘
                             │  HTTP (worker-client)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│           WORKER (Hono)                                          │
│   GET /traces · GET /traces/:id · GET /traces/:id/stream         │
│   DELETE /traces/:id · DELETE /traces?before=…                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
   ┌──────────────────────┐      ┌─────────────────────────┐
   │  TraceRegistry        │      │  TraceStore (pluggable) │
   │  (in-memory, like     │ ───► │  memory · json · sqlite │
   │   RunRegistry)        │async │  · postgres             │
   │  active traces        │flush │  durable, queryable     │
   └──────────┬───────────┘      └─────────────────────────┘
              │ live SSE                       ▲
              ▼                                │
   ┌──────────────────────────────────────────┘
   │  SpanEmitter  (the new shape of telemetry.ts)
   │  emit sites: runner.ts, manifest/executor.ts, RunRegistry
   │  optional sink: OTel passthrough (opt-in via RunnerConfig)
   └──
```

### Layer responsibilities

- **SpanEmitter** — single primitive threaded through `ExecutionContext`. Holds the active `traceId` and a stack of open span IDs (for parent inference). Emits span-start / span-end events to two sinks: the native `TraceRegistry`, and (optionally) an OTel tracer.
- **TraceRegistry** — process-wide, in-memory. Buffers spans for active traces; serves live-tail subscribers; flushes to `TraceStore` in batches. Parallel in shape to `RunRegistry`.
- **TraceStore** — durable persistence. Pluggable like `RunStore`. Backends: memory (dev), JSON (file-based), sqlite (single-node), postgres (production). Owns retention sweeps.

---

## 5. Data Model

### Span

```ts
interface Span {
  spanId:     string;        // ULID
  traceId:    string;        // ULID — every span in a tree shares this
  parentId:   string | null;
  ownerId:    string;        // tenant scoping; indexed
  runId:      string | null; // link to RunStore row when applicable
  sessionId:  string | null; // link to SessionStore row when applicable
  name:       string;        // "agent.invoke", "agent.model.call", etc.
  kind:       "run" | "manifest" | "step" | "invoke" | "model" | "tool";
  startedAt:  string;        // ISO 8601
  endedAt:    string | null; // null = in-progress
  durationMs: number | null;
  status:     "ok" | "error" | "cancelled" | "running";
  error:      string | null;
  attributes: Record<string, unknown>; // JSONB — agent.id, model, tokens, finish_reason, manifest.step, manifest.kind, etc.
  events:     Array<{ ts: string; name: string; data?: unknown }>; // JSONB — tool args/results when recordIO on
  scores:     Record<string, { value: number; reason?: string }>;  // JSONB — empty in v1; reserved for evals
  costUsd:    number | null;
}
```

Span IDs and trace IDs are **ULIDs** (26 chars, lexicographically sortable, URL-friendly). Consistent with the recent `runId` choice. When forwarding to the OTel sink, the adapter derives a 16-byte OTel-compatible ID via `sha256(ulid).slice(0,16)` so customers' Honeycomb/Datadog views stay consistent.

### Span hierarchy

```
run (top — only present if Run/RunRegistry involved)
└─ manifest (top span when no Run, otherwise child of run)
   ├─ step (only for kind:sequential|parallel; one per step/branch)
   │  └─ invoke (one core agent invocation)
   │     ├─ model.call (per LLM call; agent-loop iteration is an attribute, not a span)
   │     └─ tool.execute (per tool call)
   │        └─ invoke (only if agent-as-tool, recursively)
   └─ ...
```

For raw `runner.invoke()` calls outside a manifest or Run, the trace root is `invoke` itself. The hierarchy is **compositional** — each layer adds its span only when it's involved.

### Postgres DDL sketch

```sql
CREATE TABLE ar_spans (
  span_id      TEXT PRIMARY KEY,
  trace_id     TEXT NOT NULL,
  parent_id    TEXT,
  owner_id     TEXT NOT NULL,
  run_id       TEXT,
  session_id   TEXT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('run','manifest','step','invoke','model','tool')),
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ,
  duration_ms  INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('ok','error','cancelled','running')),
  error        TEXT,
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
  events       JSONB NOT NULL DEFAULT '[]'::jsonb,
  scores       JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_usd     NUMERIC(12,6)
);

CREATE INDEX ar_spans_owner_started ON ar_spans (owner_id, started_at DESC);
CREATE INDEX ar_spans_trace ON ar_spans (trace_id);
CREATE INDEX ar_spans_parent ON ar_spans (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX ar_spans_owner_name_started ON ar_spans (owner_id, name, started_at DESC);
CREATE INDEX ar_spans_owner_run ON ar_spans (owner_id, run_id) WHERE run_id IS NOT NULL;

CREATE TABLE ar_trace_summaries (
  trace_id       TEXT PRIMARY KEY,
  owner_id       TEXT NOT NULL,
  root_name      TEXT NOT NULL,
  agent_id       TEXT,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ,
  duration_ms    INTEGER,
  span_count     INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('ok','error','cancelled','running')),
  total_tokens   INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(12,6)
);

CREATE INDEX ar_trace_summaries_owner_started ON ar_trace_summaries (owner_id, started_at DESC);
CREATE INDEX ar_trace_summaries_owner_agent ON ar_trace_summaries (owner_id, agent_id) WHERE agent_id IS NOT NULL;
```

`ar_trace_summaries` holds precomputed roll-ups written on trace end (and updated for in-progress traces in the registry). Powers the list view without scanning all spans. The on-the-fly aggregation alternative (`SELECT FROM ar_spans GROUP BY trace_id`) is bench-driven in Slice 1 — start with precomputed.

### TraceStore interface

```ts
interface TraceStore {
  insertSpan(span: Span): Promise<void>;
  insertSpansBatch(spans: Span[]): Promise<void>;          // used by registry flush
  updateSpan(spanId: string, patch: Partial<Span>): Promise<void>;
  upsertSummary(summary: TraceSummary): Promise<void>;
  getTrace(traceId: string, ownerId: string): Promise<Span[]>;
  getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null>;
  listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }>;
  deleteTrace(traceId: string, ownerId: string): Promise<void>;
  deleteOlderThan(ownerId: string, before: Date): Promise<number>;
}

interface TraceFilter {
  ownerId: string;
  agentId?: string;
  status?: Span["status"];
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;     // default 50, max 200
  cursor?: string;    // opaque, encodes (started_at, trace_id)
}

interface TraceSummary {
  traceId: string;
  ownerId: string;
  rootName: string;
  agentId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  spanCount: number;
  status: Span["status"];
  totalTokens: number;
  totalCostUsd: number | null;
}
```

Same shape as `RunStore` — fits agntz's pluggable-stores pattern.

---

## 6. Span Emission & Live Tail

### Emit sites

| Span kind | Emitted from | When |
|---|---|---|
| `run` | `RunRegistry.start()` (existing emit point) | Run created |
| `manifest` | `packages/manifest/src/executor.ts:executeWithState` | Manifest dispatch start |
| `step` | `pipeline/sequential.ts` per step, `pipeline/parallel.ts` per branch | Inside the loop |
| `invoke` | `packages/core/src/runner.ts` (today's `telemetry.startInvoke`) | `invoke()` / `stream()` start |
| `model.call` | `runner.ts` agent loop, per iteration | Before `modelProvider.generateText` |
| `tool.execute` | `runner.ts` agent loop, per tool call | Before `toolRegistry.execute` |

The current `Telemetry` class generalizes to `SpanEmitter` — same shape, two sinks: native (TraceRegistry) and OTel (optional, opt-in).

### Trace ID propagation

`traceId` is created when the **top span** opens (`run.start`, or `manifest.start` if no run, or `invoke.start` if no manifest). Subsequent emits in the same execution context inherit it via the emitter. `parentId` is the spanId of the currently active span when a new span opens — tracked via an explicit stack in the emitter, threaded through `ExecutionContext`.

The bridge (`packages/worker/src/bridge.ts`) constructs one `SpanEmitter` per request and wires it through `CreateExecutionContextOptions`. Executor and runner share the same instance, which means they share the same `traceId` and stack.

### TraceRegistry

```ts
interface TraceRegistry {
  // Emission path — called by SpanEmitter
  spanStart(span: Span): void;
  spanEnd(spanId: string, patch: Partial<Span>): void;

  // Subscribe to live span events for a trace (powers SSE)
  subscribe(traceId: string, ownerId: string): AsyncIterable<TraceLiveEvent>;

  // Query in-progress traces (fallback if not yet flushed to store)
  getInProgress(traceId: string, ownerId: string): Span[] | null;
}

type TraceLiveEvent =
  | { type: "span-start";  span: Span }
  | { type: "span-end";    spanId: string; patch: Partial<Span> }
  | { type: "trace-done";  summary: TraceSummary };
```

Owns:

1. **Live tail source.** SSE subscribers read from the registry's in-memory state, not the DB. The registry is the only place that has up-to-the-millisecond in-progress trace state.
2. **Async flush coordinator.** Spans buffered as they emit; flushed to TraceStore in batches.

### Async flush policy

- **On `spanEnd`:** add span (full row, now with `endedAt` populated) to a per-trace write buffer. UI subscribers see the event immediately via the in-memory channel.
- **Flush trigger:** every **100 spans** OR every **250ms**, whichever first.
- **Final flush:** guaranteed on `trace-done`. Also writes the `TraceSummary` row.
- **Backpressure:** if Postgres falls behind, the per-owner buffer caps at **10,000 spans**. Beyond that: first stop OTel forwarding (cheap), then start dropping `tool.execute` spans (preserve `invoke`/`model`/`manifest`/`run`/`step`). Log a warning. This is crude v1 sampling under load.
- **Crash safety:** registry persists its buffer on graceful shutdown (`SIGTERM` handler in worker). A hard crash loses in-flight spans — acceptable v1 tradeoff, matches existing `sessionStore.append`-at-end behavior.

### Live tail SSE

`GET /traces/:id/stream` semantics:

1. Auth (bearer or internal) + owner check via `traceId → ownerId` lookup (registry first, store fallback).
2. If trace is in registry: stream **backlog** (current snapshot of all in-memory spans), then subscribe to live `TraceLiveEvent`s. Connection closes on `trace-done`.
3. If trace is only in store: serve as a one-shot replay (no live tail since it's already done) — same SSE format, terminates after backlog.
4. Heartbeat every **15s** to keep the connection open through proxies.

UI applies events as patches to a local tree; no polling.

### OTel sink survival

The existing `telemetry.ts` OTel passthrough becomes one of two emit targets:

1. **Native sink** (default, always on): writes to `TraceRegistry` → flushes to `TraceStore`.
2. **OTel sink** (opt-in via `RunnerConfig.telemetry.otelTracer`): forwards the same spans to a customer-configured OTel tracer.

Both can run simultaneously. Zero overhead when OTel is off.

---

## 7. HTTP + SDK Surface

### Worker routes

| Method + Path | Auth | Purpose |
|---|---|---|
| `GET /traces` | `workerAuth` | List traces; query params: `agentId`, `status`, `startedAfter`, `startedBefore`, `cursor`, `limit` |
| `GET /traces/:traceId` | `workerAuth` | Return `{ summary, spans: Span[] }` — registry first, store fallback |
| `GET /traces/:traceId/stream` | `workerAuth` | SSE: backlog + live `TraceLiveEvent`s if active; replays then closes if done |
| `DELETE /traces/:traceId` | `workerAuth` | Soft-delete (tombstone, hard-purged by retention) |
| `DELETE /traces?before=ISO` | `workerAuth` | Bulk retention sweep (also runs periodically as a background job) |

All routes owner-scoped. `ownerId` is resolved from auth middleware (`worker/middleware/auth.ts`); never appears in the URL.

### SDK resource

```ts
class TracesResource {
  list(filter?: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }>;
  get(traceId: string): Promise<{ summary: TraceSummary; spans: Span[] }>;
  stream(traceId: string): AsyncIterable<TraceLiveEvent>;
  delete(traceId: string): Promise<void>;
}
```

Mirrors `RunsResource` shape. `normalizeTraceLiveEvent` parser added to `packages/sdk/src/internal/sse.ts` next to `normalizeRunEvent`.

### Public exports

`packages/sdk/src/index.ts` adds:

```ts
export { TracesResource } from "./resources/traces.js";
export type { Span, TraceSummary, TraceFilter, TraceLiveEvent } from "./resources/traces.js";
```

---

## 8. UI Surface

Two new pages in `packages/app/src/app/(dashboard)/traces/`:

### `page.tsx` — Traces list

```
┌── Traces ──────────────────────────────────────────────────────────┐
│ [Filter: agent ▼] [status ▼] [last 24h ▼]      [Live: 3 active ●]  │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ ID         Agent        Status   Started     Dur     Spans   │   │
│ │ tr_01H…   notes-agent  ● ok     2m ago      4.2s    37       │   │
│ │ tr_01H…   sales-bot    ● running 12s ago    —       12  live │   │
│ │ tr_01H…   notes-agent  ● error  8m ago      1.8s    14       │   │
│ └──────────────────────────────────────────────────────────────┘   │
│ [Load more]                                                         │
└────────────────────────────────────────────────────────────────────┘
```

### `[traceId]/page.tsx` — Trace detail

```
┌── Trace tr_01H… · notes-agent · 4.2s · 37 spans · ok ───────────────────┐
│ Gantt strip (proportional timing) ────────────────────────────────────── │
│ run            ████████████████████████████████████                      │
│  manifest      ████████████████████████████████████                      │
│   step:fetch   ███████                                                   │
│    invoke      ███████                                                   │
│     model      ██                                                        │
│     tool       █████                                                     │
│   step:summ.          █████████████████████████████                      │
│                                                                          │
│ ┌── Span tree ────────────┐ ┌── Span detail ──────────────────────────┐ │
│ │ ▼ run                   │ │ name: agent.model.call                  │ │
│ │   ▼ manifest            │ │ duration: 320ms · tokens in/out: 412/89 │ │
│ │     ▼ step:fetch        │ │ model: anthropic/claude-sonnet-4-6      │ │
│ │       ▼ invoke          │ │ finish_reason: tool_use                 │ │
│ │         · model    ●    │ │ attributes: { agent.step: 1, ... }      │ │
│ │         · tool     ●    │ │ ────────────                             │ │
│ │     ▶ step:summarize    │ │ input/output (collapsed JSON, if on)    │ │
│ └─────────────────────────┘ └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Live indicator:** if `summary.status === "running"`, subscribe to `/traces/:id/stream` on mount; tree updates in real-time; unsubscribe on `trace-done`.
- **IO recording banner:** when no `events`/IO data is present, show `Inputs/outputs not recorded. Enable in agent settings to capture.`
- **Navigation:** add `Traces` link to existing main nav. Cross-linking from `Runs` detail page is v1.1.

Components: reuse existing `Table` for list, build `SpanTree` (Radix Collapsible), `GanttStrip` (custom), `SpanDetailDrawer` (existing drawer pattern). Use existing `JsonView` for attribute rendering.

---

## 9. Back-compat & Defaults

### InvocationLog migration

- **v1 (this work):** the runner's existing `logStore.log()` call site in `runner.ts:1081` continues to write `InvocationLog` rows as today. The new `SpanEmitter` writes `invoke`-kind spans to `TraceStore` in parallel. Two write paths; no consumer breaks. (The `LogStore` interface itself is unchanged in v1.)
- **v1.1+ (follow-up):** replace `ar_invocation_logs` with a SQL view: `CREATE VIEW ar_invocation_logs AS SELECT … FROM ar_spans WHERE kind='invoke'`. Drop the `logStore.log()` call from `runner.ts`. `LogStore` interface stays alive, backed by the view; consumers see no API change.

### OTel adapter

Kept as an opt-in sink on `SpanEmitter`. Customers configure via `RunnerConfig.telemetry.otelTracer`. Zero overhead when off.

### IO recording

**Default off.** Preserves existing `telemetry.ts` behavior. Per-agent override via manifest field (TBD field name in Slice 2 — likely `telemetry: { recordIO: true }`); per-deployment override via `RunnerConfig.telemetry.recordIO`. UI banner when IO is off on a trace.

### Retention

- Default: 30 days free tier, 90 days paid (defer billing-tier wiring; v1 just uses `TRACE_RETENTION_DAYS` env, default 30).
- Mechanism: daily worker-side scheduled job calling `traceStore.deleteOlderThan(ownerId, threshold)` per owner. Implemented with `node-cron` (new dep) or simple `setInterval` — TBD in Slice 1.
- Per-trace pinning: v1.1.

### Sampling

None in v1. Backpressure under load drops tool spans as crude sampling.

### Multi-tenant scoping

`ownerId` on every row. All queries filter on it. Resolved from auth middleware server-side. SDK never sees it.

### Cost tracking

`costUsd` computed at `model.call` span end from `(usage.promptTokens × promptRate + usage.completionTokens × completionRate)`. Per-model rate table in new file `packages/core/src/model-pricing.ts` with defaults for major providers; per-deployment override via env. Rolls up into `TraceSummary.totalCostUsd`.

### Span ID format

ULID for `traceId` and `spanId`. OTel-format IDs derived (`sha256(ulid).slice(0,16)`) only when forwarding to the OTel sink.

---

## 10. Testing Strategy

### Unit

- **`TraceStore` conformance suite** — shared across memory / JSON / sqlite / postgres backends. Covers insert, upsert summary, get-by-trace, list-with-filters, retention sweep, owner scoping.
- **`SpanEmitter`** — emission ordering (parent before child), trace ID propagation, status transitions, IO recording on/off, cost calculation per model.
- **`TraceRegistry`** — span buffering, flush triggers (count + time), backpressure drop policy, subscribe channel cleanup on unsubscribe, in-progress span queries.

### Integration

- **`packages/worker/src/__tests__/traces-routes.test.ts`** — mirrors `runs-routes.test.ts`. 5 routes × auth (bearer + internal) × owner scoping × pagination cursor × SSE backlog + live events.
- **End-to-end through `runner.invoke()` / `runner.stream()`** — runner + in-memory TraceStore + mock tool + stub model; run a multi-step manifest; assert resulting span tree matches expected hierarchy.
- **Live-tail SSE end-to-end** — long-running invoke; verify backlog → live events → clean close on `trace-done`.

### SDK

- **`TracesResource` test suite** — list/get/stream/delete. Mock fetch like existing `runs.test.ts`.

### UI

- **Component tests** — `SpanTree` (collapsed/expanded), `GanttStrip` (proportional rendering), `SpanDetailDrawer` (attributes vs IO views), live indicator updates on SSE events.
- **Snapshot fixtures** — completed trace, in-progress trace mid-tool-call.
- **Manual smoke test pre-merge** — run a real agent through `agntz.co`, watch the trace appear and tail in the UI.

### Fixtures

`packages/core/src/__tests__/fixtures/traces.ts` — exported fixture sets consumed by SDK / worker / UI tests:

- `simpleInvokeTrace` — single `invoke > model.call`
- `toolCallingTrace` — `invoke > {model.call ×2, tool.execute ×1}`
- `sequentialManifestTrace` — `run > manifest > step ×3 > invoke > model.call`
- `parallelManifestTrace` — `run > manifest > step ×3 (parallel) > invoke`
- `agentAsToolTrace` — `invoke > tool.execute > invoke` (nested)
- `erroredTrace` — partial trace with error in tool span
- `inProgressTrace` — three spans, last has `endedAt: null`

### Performance gates (informational)

- 10k spans inserted in <2s on Postgres (informs flush batch size of 100)
- 1M-span query by `(ownerId, startedAt DESC)` in <100ms with the right index
- SSE backlog for a 200-span trace under 50ms wall-clock to first event

Baked into `packages/worker/scripts/bench-traces.ts`. Not in CI for v1; available for manual perf checks.

---

## 11. Open questions / TBD in implementation

These don't block the spec but resolve during the slice implementations:

- **Manifest field for per-agent IO recording.** Name TBD in Slice 2 — likely `telemetry: { recordIO: true }` at the manifest top level.
- **Retention scheduler choice.** `node-cron` vs `setInterval` vs piggyback on existing infrastructure. Resolve in Slice 1.
- **Precomputed summary vs on-the-fly aggregation.** Bench during Slice 1 — start with precomputed, fall back to on-the-fly if write contention becomes painful.
- **Backpressure thresholds (100/250ms/10k).** Initial values from prior art; tune from production telemetry.
- **Per-model price table source.** Hardcoded bundled defaults vs `STORE`-backed customer overrides. Start hardcoded; defer dynamic in v1.1.

---

## 12. Risks

- **Refactor scope on `telemetry.ts` → `SpanEmitter`.** All emit sites in `runner.ts` change shape. Mitigation: keep the existing class signature as a thin shim for v1 to avoid touching unaffected callers; deprecate in v1.1.
- **TraceRegistry as new shared state.** Like `RunRegistry` (recently shipped), this is process-wide singleton state. Multi-process deployments need owner-scoped routing — same problem RunRegistry solved post-PR #19, so mitigate by following its patterns directly.
- **Postgres write amplification.** 60+ inserts per `invoke` if naive. Mitigated by batched flush. If real-world load shows issues, the backpressure path is well-defined.
- **Live tail correctness under reconnect.** Client losing the SSE mid-trace must be able to rejoin and not miss events. Mitigation: SSE backlog on (re)connect always replays full current state, then continues live — idempotent rendering on the client side handles duplicates safely.

---

## 13. Slice breakdown (handoff to writing-plans)

| Slice | Branch | Touches | Estimated PR size |
|---|---|---|---|
| 1 | `slice-N-trace-store` | `packages/core/src/types.ts`, new `packages/core/src/trace-store.ts`, all `packages/store-*`, migrations | ~600 LOC + tests |
| 2 | `slice-N-span-emission` | `packages/core/src/telemetry.ts` (renamed), `packages/core/src/run-registry.ts`, `packages/core/src/runner.ts`, `packages/manifest/src/executor.ts`, `packages/manifest/src/pipeline/*`, new `packages/worker/src/trace-registry.ts` | ~800 LOC + tests |
| 3 | `slice-N-traces-http` | `packages/worker/src/routes.ts`, `packages/sdk/src/resources/traces.ts`, `packages/sdk/src/internal/sse.ts`, exports | ~500 LOC + tests |
| 4 | `slice-N-traces-ui` | `packages/app/src/app/(dashboard)/traces/`, nav, new components | ~700 LOC + visual snapshot tests |

Each slice independently mergeable; each slice's PR description references this spec by path.

---

## 14. Definition of done

**v1 ships when:**

1. All four slices merged to `main`.
2. End-to-end smoke test: create an agent through `agntz.co`, run it, see its trace appear in `/traces`, drill into the tree, watch the next invocation tail live.
3. `LogStore.log()` still passes its existing tests (back-compat preserved).
4. The recently shipped `/runs/*` flows still pass their existing tests (no regression).
5. Postgres migration applied cleanly on a fresh and an existing database.
6. The implementation-plan skill produces an executable plan for each slice with TDD test fixtures included.

---

*This spec was produced by the brainstorming skill on 2026-05-11. The implementation plan is produced separately by the writing-plans skill.*
