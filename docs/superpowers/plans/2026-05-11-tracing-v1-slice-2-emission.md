# Tracing v1 — Slice 2: Span Emission & TraceRegistry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-11-tracing-v1-design.md` (Sections 4, 6, 9)
**Prior slice:** `docs/superpowers/plans/2026-05-11-tracing-v1-slice-1-tracestore.md` (merged in PR #21)

**Goal:** Hook span emission into the agent runtime so every `runner.invoke()`, manifest execution, and Run spawns the appropriate span tree (`run > manifest > [step?] > invoke > {model.call, tool.execute}`), persists it to TraceStore via a process-wide `TraceRegistry`, and exposes live-tail events through an in-memory subscribe channel for later UI consumption.

**Architecture:** A new `SpanEmitter` primitive (refactoring `packages/core/src/telemetry.ts`) holds a stack of active spans and threads `traceId` through an `ExecutionContext`. Span lifecycle events flow to two sinks: the new `TraceRegistry` (in-memory, process-wide; powers live tail and batches writes to TraceStore) and the existing OpenTelemetry passthrough (opt-in for power users). Emit points: `runner.ts` (already has invoke/model/tool — refactor to use stack-based parentage), `manifest/executor.ts` (new manifest span), `manifest/pipeline/{sequential,parallel}.ts` (new step spans per step/branch), and `core/run-registry.ts` (new run span). Cost computation lands at `model.call` span end via a new `packages/core/src/model-pricing.ts` rate table.

**Tech Stack:** TypeScript, vitest, pnpm workspaces with turbo, `@opentelemetry/api` (already a dynamic optional dep), `pg`/`better-sqlite3`/`fs` via the TraceStore landed in Slice 1.

---

## Branch + working state

- [ ] **Step 0.1: Sync `main` and verify Slice 1 is in place**

```bash
git checkout main
git pull --ff-only
git log --oneline -3
ls packages/core/src/__tests__/trace-store-conformance.ts
```

Expected: top commit is the merge of PR #21 (`Tracing v1 Slice 1: TraceStore foundation`); the conformance suite file exists. If not, STOP and report — Slice 2 depends on Slice 1's TraceStore being on `main`.

- [ ] **Step 0.2: Create the slice branch**

```bash
git checkout -b slice-5-span-emission
```

- [ ] **Step 0.3: Confirm baseline tests pass**

```bash
pnpm install
pnpm test
```

Expected: all packages green. Postgres trace tests skip without `DATABASE_URL` — fine.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/telemetry.ts` | Modify | Rename `Telemetry` → `SpanEmitter`; add stack-based parentage; dual sinks (native via `TraceSink` callback + existing OTel). Keep old class shape as a backward-compat re-export. |
| `packages/core/src/__tests__/span-emitter.test.ts` | Create | Unit tests for SpanEmitter — span hierarchy, traceId propagation, parent linkage, sink invocation. |
| `packages/core/src/model-pricing.ts` | Create | Per-model token-rate table + `computeCost(usage, model)` helper. |
| `packages/core/src/runner.ts` | Modify | Refactor span emit sites to use the new `SpanEmitter` API. Add `runId` propagation through `model.call`/`tool.execute` attributes. |
| `packages/core/src/run-registry.ts` | Modify | Hook `create`/`start`/`notifyCompleted`/`notifyFailed` to emit `run` kind spans through a configured `SpanEmitter`. |
| `packages/manifest/src/types.ts` | Modify | Extend `ExecutionContext` interface with an optional `spanEmitter?: SpanEmitter` field. |
| `packages/manifest/src/executor.ts` | Modify | `executeWithState` opens a `manifest` span around dispatch and closes on resolve/reject. |
| `packages/manifest/src/pipeline/sequential.ts` | Modify | Open a `step` span around each `executeWithState(childManifest, …)` call. |
| `packages/manifest/src/pipeline/parallel.ts` | Modify | Open a `step` span around each branch in `branchPromises`. |
| `packages/worker/src/trace-registry.ts` | Create | New `TraceRegistry` interface + `InMemoryTraceRegistry` impl with subscribe channels, async flush to `TraceStore` (100 spans or 250ms), backpressure cap (10k spans/owner). |
| `packages/worker/src/__tests__/trace-registry.test.ts` | Create | Unit tests for buffering, flush triggers, subscribe semantics, backpressure. |
| `packages/worker/src/bridge.ts` | Modify | Construct `SpanEmitter` per request, configure native sink → TraceRegistry, thread into `ExecutionContext` via `CreateExecutionContextOptions`. Pass through `runner.invoke()` via `InvokeOptions.spanEmitter`. |
| `packages/worker/src/routes.ts` | Modify | `/run` and `/run/stream` instantiate `SpanEmitter` per request using process-wide `TraceRegistry`. |
| `packages/core/src/types.ts` | Modify | Extend `InvokeOptions` and `RunnerConfig` with optional `spanEmitter`; add `TraceSink` callback shape. |
| `packages/worker/tests/span-emission-e2e.test.ts` | Create | End-to-end: build a small manifest, run via runner with an in-memory TraceStore, assert the full span tree shape. |

---

## Architectural sketch (read before tasks)

### `SpanEmitter` data flow

```
   bridge.ts (per request):
     emitter = new SpanEmitter({
       traceSink: traceRegistry.acceptEvent,   // native sink
       otelTracer: config.telemetry?.otelTracer, // optional
       recordIO: false,
     });

   bridge then passes emitter into:
     - ExecutionContext.spanEmitter   (read by executor.ts, pipeline/*)
     - runner.invoke(id, input, { spanEmitter, ... })  (read by runner.ts)

   inside runner / executor / pipelines:
     emitter.startManifest({...}) → returns ManifestSpan
       emitter.startStep({...})   → returns StepSpan
         emitter.startInvoke({...}) → returns InvokeSpan
           emitter.startModelCall({...})  → returns ModelCallSpan
           emitter.startToolCall({...})   → returns ToolCallSpan

   on each span lifecycle event, emitter calls traceSink({
     type: "span-start" | "span-end",
     span: { spanId, traceId, parentId, ownerId, runId, ... }
   })

   traceRegistry receives events → buffers + flushes to TraceStore + multicasts to live subscribers
```

### Stack-based parentage

`SpanEmitter` maintains a per-trace stack of active spans. When `startSomething()` is called, the new span's `parentId` is the top of the stack (or `null` if the stack is empty — that span becomes the root and gets a new `traceId`). When `end()` is called, the span pops off the stack.

This is the **only** way the cross-layer parent linkage works without explicit threading of parent IDs through every function signature.

### TraceRegistry responsibilities

1. **Live-tail source.** Subscribers attach via `subscribe(traceId, ownerId)` and receive an `AsyncIterable<TraceLiveEvent>` of in-flight events.
2. **Async batch writer.** Flush every 100 spans OR every 250ms — whichever first. On `trace-done`, flush + write the precomputed `TraceSummary`.
3. **Backpressure.** Per-owner buffer caps at 10k spans. Beyond cap: skip OTel forwarding first, then drop `tool.execute` spans (preserve `invoke`/`model`/`manifest`/`run`/`step`). Log a warning.

---

## Task 1: `TraceRegistry` primitive + in-memory implementation

**Files:**
- Create: `packages/worker/src/trace-registry.ts`
- Create: `packages/worker/src/__tests__/trace-registry.test.ts`

### Step 1.1: Write the failing tests

Create `packages/worker/src/__tests__/trace-registry.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Span, TraceStore, TraceSummary } from "@agntz/core";
import { InMemoryTraceRegistry } from "../trace-registry.js";

class FakeTraceStore implements Pick<TraceStore, "insertSpansBatch" | "upsertSummary"> {
  inserted: Span[] = [];
  summaries: TraceSummary[] = [];
  async insertSpansBatch(spans: Span[]): Promise<void> {
    this.inserted.push(...spans);
  }
  async upsertSummary(summary: TraceSummary): Promise<void> {
    this.summaries.push(summary);
  }
}

function makeSpan(over: Partial<Span> = {}): Span {
  return {
    spanId: over.spanId ?? `sp_${Math.random().toString(36).slice(2)}`,
    traceId: over.traceId ?? "tr_x",
    parentId: over.parentId ?? null,
    ownerId: over.ownerId ?? "u1",
    runId: null,
    sessionId: null,
    name: over.name ?? "agent.invoke",
    kind: over.kind ?? "invoke",
    startedAt: over.startedAt ?? new Date().toISOString(),
    endedAt: over.endedAt ?? null,
    durationMs: null,
    status: over.status ?? "running",
    error: null,
    attributes: {},
    events: [],
    scores: {},
    costUsd: null,
  };
}

describe("InMemoryTraceRegistry", () => {
  let store: FakeTraceStore;
  let registry: InMemoryTraceRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new FakeTraceStore();
    registry = new InMemoryTraceRegistry({
      store: store as unknown as TraceStore,
      flushBatchSize: 3,
      flushIntervalMs: 250,
      maxBufferPerOwner: 10,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes after flushBatchSize span-ends", async () => {
    for (let i = 0; i < 3; i++) {
      registry.spanStart(makeSpan({ spanId: `sp_${i}` }));
      registry.spanEnd(`sp_${i}`, { endedAt: new Date().toISOString(), status: "ok" });
    }
    await registry.waitForFlush();
    expect(store.inserted).toHaveLength(3);
  });

  it("flushes after flushIntervalMs even if under batch size", async () => {
    registry.spanStart(makeSpan({ spanId: "sp_a" }));
    registry.spanEnd("sp_a", { endedAt: new Date().toISOString(), status: "ok" });
    expect(store.inserted).toHaveLength(0); // under batch threshold
    await vi.advanceTimersByTimeAsync(250);
    expect(store.inserted).toHaveLength(1);
  });

  it("subscribers receive live span-start / span-end / trace-done events", async () => {
    const iterator = registry.subscribe("tr_sub", "u1");
    const events: unknown[] = [];
    const consumeP = (async () => {
      for await (const e of iterator) {
        events.push(e);
        if (e.type === "trace-done") break;
      }
    })();

    const span = makeSpan({ spanId: "sp_sub_1", traceId: "tr_sub" });
    registry.spanStart(span);
    registry.spanEnd("sp_sub_1", { endedAt: new Date().toISOString(), status: "ok" });
    registry.traceDone("tr_sub", "u1", {
      traceId: "tr_sub",
      ownerId: "u1",
      rootName: "agent.invoke",
      agentId: null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 0,
      spanCount: 1,
      status: "ok",
      totalTokens: 0,
      totalCostUsd: null,
    });

    await consumeP;
    expect(events).toHaveLength(3);
    expect((events[0] as { type: string }).type).toBe("span-start");
    expect((events[1] as { type: string }).type).toBe("span-end");
    expect((events[2] as { type: string }).type).toBe("trace-done");
  });

  it("owner-scopes subscribers (u1 does not see u2 spans)", async () => {
    const u1Iter = registry.subscribe("tr_shared", "u1");
    const u2Iter = registry.subscribe("tr_shared", "u2");
    const u1Events: unknown[] = [];
    const u2Events: unknown[] = [];
    const consume = async (iter: AsyncIterable<unknown>, sink: unknown[]) => {
      for await (const e of iter) {
        sink.push(e);
        if ((e as { type: string }).type === "trace-done") break;
      }
    };
    const p1 = consume(u1Iter, u1Events);
    const p2 = consume(u2Iter, u2Events);

    registry.spanStart(makeSpan({ spanId: "sp_u1", traceId: "tr_shared", ownerId: "u1" }));
    registry.spanStart(makeSpan({ spanId: "sp_u2", traceId: "tr_shared", ownerId: "u2" }));
    registry.traceDone("tr_shared", "u1", makeSummary("tr_shared", "u1"));
    registry.traceDone("tr_shared", "u2", makeSummary("tr_shared", "u2"));

    await Promise.all([p1, p2]);
    expect(u1Events).toHaveLength(2); // start + done
    expect(u2Events).toHaveLength(2);
    // u1's span was 'sp_u1', not 'sp_u2'
    expect((u1Events[0] as { span: { spanId: string } }).span.spanId).toBe("sp_u1");
    expect((u2Events[0] as { span: { spanId: string } }).span.spanId).toBe("sp_u2");
  });

  it("backpressure drops tool.execute spans first when buffer exceeds cap", async () => {
    // Fill buffer with 10 invoke spans (at cap)
    for (let i = 0; i < 10; i++) {
      registry.spanStart(makeSpan({ spanId: `sp_inv_${i}`, kind: "invoke" }));
    }
    // Adding a tool span beyond cap should be dropped
    registry.spanStart(makeSpan({ spanId: "sp_tool_over", kind: "tool" }));
    await registry.waitForFlush();
    const insertedIds = new Set(store.inserted.map((s) => s.spanId));
    expect(insertedIds.has("sp_tool_over")).toBe(false);
    // Invoke spans survive
    expect(insertedIds.has("sp_inv_0")).toBe(true);
  });

  it("getInProgress returns active spans for trace", () => {
    registry.spanStart(makeSpan({ spanId: "sp_ip_1", traceId: "tr_ip", ownerId: "u1" }));
    registry.spanStart(makeSpan({ spanId: "sp_ip_2", traceId: "tr_ip", ownerId: "u1" }));
    const got = registry.getInProgress("tr_ip", "u1");
    expect(got).not.toBeNull();
    expect(got!).toHaveLength(2);
  });

  it("getInProgress returns null for unknown trace", () => {
    expect(registry.getInProgress("tr_nope", "u1")).toBeNull();
  });
});

function makeSummary(traceId: string, ownerId: string): TraceSummary {
  return {
    traceId,
    ownerId,
    rootName: "agent.invoke",
    agentId: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 0,
    spanCount: 0,
    status: "ok",
    totalTokens: 0,
    totalCostUsd: null,
  };
}
```

Run:

```bash
cd packages/worker
pnpm test trace-registry
```

Expected: FAIL — `InMemoryTraceRegistry` doesn't exist yet.

### Step 1.2: Implement `TraceRegistry`

Create `packages/worker/src/trace-registry.ts`:

```ts
import type { Span, TraceStore, TraceSummary, TraceLiveEvent } from "@agntz/core";

export interface TraceRegistry {
  spanStart(span: Span): void;
  spanEnd(spanId: string, patch: Partial<Span>): void;
  traceDone(traceId: string, ownerId: string, summary: TraceSummary): void;

  subscribe(traceId: string, ownerId: string): AsyncIterable<TraceLiveEvent>;
  getInProgress(traceId: string, ownerId: string): Span[] | null;

  /** For tests / graceful shutdown. Flushes the pending buffer synchronously. */
  waitForFlush(): Promise<void>;
}

export interface InMemoryTraceRegistryOptions {
  store: TraceStore;
  /** Default 100. Flush whenever the pending buffer reaches this count. */
  flushBatchSize?: number;
  /** Default 250. Flush whenever a buffer's age exceeds this many ms. */
  flushIntervalMs?: number;
  /** Default 10_000. Per-owner buffer ceiling; backpressure drops further tool spans. */
  maxBufferPerOwner?: number;
}

interface Subscriber {
  traceId: string;
  ownerId: string;
  push(event: TraceLiveEvent): void;
  done(): void;
}

export class InMemoryTraceRegistry implements TraceRegistry {
  private store: TraceStore;
  private flushBatchSize: number;
  private flushIntervalMs: number;
  private maxBufferPerOwner: number;

  // Active spans by spanId — used by getInProgress and span-end patches.
  private active = new Map<string, Span>();
  // Per-owner pending buffer for batched writes.
  private pendingByOwner = new Map<string, Span[]>();
  // Timer per owner to honour flushIntervalMs.
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Pending flush promise so waitForFlush() can await it.
  private inflightFlushes: Promise<void>[] = [];
  // Subscribers keyed by `${traceId}::${ownerId}`.
  private subscribers = new Map<string, Set<Subscriber>>();

  constructor(opts: InMemoryTraceRegistryOptions) {
    this.store = opts.store;
    this.flushBatchSize = opts.flushBatchSize ?? 100;
    this.flushIntervalMs = opts.flushIntervalMs ?? 250;
    this.maxBufferPerOwner = opts.maxBufferPerOwner ?? 10_000;
  }

  spanStart(span: Span): void {
    // Backpressure: if this owner's pending buffer is at cap, drop tool spans first.
    const pending = this.pendingByOwner.get(span.ownerId);
    if (pending && pending.length >= this.maxBufferPerOwner && span.kind === "tool") {
      // Drop silently — best-effort under load. Could log here.
      return;
    }
    this.active.set(span.spanId, { ...span });
    this.broadcast(span.traceId, span.ownerId, { type: "span-start", span });
  }

  spanEnd(spanId: string, patch: Partial<Span>): void {
    const existing = this.active.get(spanId);
    if (!existing) return; // span-end without span-start — ignore
    const merged: Span = { ...existing, ...patch, spanId };
    this.active.delete(spanId);
    this.enqueue(merged);
    this.broadcast(existing.traceId, existing.ownerId, {
      type: "span-end",
      spanId,
      patch,
    });
  }

  traceDone(traceId: string, ownerId: string, summary: TraceSummary): void {
    // Write the summary immediately (not batched — small, infrequent).
    this.inflightFlushes.push(this.store.upsertSummary(summary).catch(() => {}));
    this.broadcast(traceId, ownerId, { type: "trace-done", summary });
    // Close out subscribers for this trace.
    const key = `${traceId}::${ownerId}`;
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const sub of subs) sub.done();
      this.subscribers.delete(key);
    }
    // Drain pending buffer for this owner so all spans land before subscribers see trace-done finished writing.
    this.scheduleFlush(ownerId, /*immediate*/ true);
  }

  subscribe(traceId: string, ownerId: string): AsyncIterable<TraceLiveEvent> {
    const key = `${traceId}::${ownerId}`;
    let resolveNext: ((value: IteratorResult<TraceLiveEvent>) => void) | null = null;
    const queue: TraceLiveEvent[] = [];
    let closed = false;

    const sub: Subscriber = {
      traceId,
      ownerId,
      push: (event) => {
        if (closed) return;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: event, done: false });
        } else {
          queue.push(event);
        }
      },
      done: () => {
        closed = true;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: undefined as unknown as TraceLiveEvent, done: true });
        }
      },
    };

    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(sub);

    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<TraceLiveEvent>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined as unknown as TraceLiveEvent, done: true });
            }
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
          return(): Promise<IteratorResult<TraceLiveEvent>> {
            sub.done();
            set!.delete(sub);
            return Promise.resolve({ value: undefined as unknown as TraceLiveEvent, done: true });
          },
        };
      },
    };
  }

  getInProgress(traceId: string, ownerId: string): Span[] | null {
    const out: Span[] = [];
    for (const s of this.active.values()) {
      if (s.traceId === traceId && s.ownerId === ownerId) out.push({ ...s });
    }
    return out.length > 0 ? out : null;
  }

  async waitForFlush(): Promise<void> {
    // Flush all owners immediately and await pending writes.
    for (const ownerId of this.pendingByOwner.keys()) {
      this.scheduleFlush(ownerId, true);
    }
    await Promise.all(this.inflightFlushes.splice(0));
  }

  // ───── internals ─────

  private enqueue(span: Span): void {
    let pending = this.pendingByOwner.get(span.ownerId);
    if (!pending) {
      pending = [];
      this.pendingByOwner.set(span.ownerId, pending);
    }
    pending.push(span);
    if (pending.length >= this.flushBatchSize) {
      this.scheduleFlush(span.ownerId, true);
    } else if (!this.flushTimers.has(span.ownerId)) {
      const t = setTimeout(() => this.scheduleFlush(span.ownerId, true), this.flushIntervalMs);
      this.flushTimers.set(span.ownerId, t);
    }
  }

  private scheduleFlush(ownerId: string, immediate: boolean): void {
    const timer = this.flushTimers.get(ownerId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(ownerId);
    }
    if (!immediate) return;
    const pending = this.pendingByOwner.get(ownerId);
    if (!pending || pending.length === 0) return;
    const batch = pending.splice(0);
    const flushP = this.store.insertSpansBatch(batch).catch(() => {});
    this.inflightFlushes.push(flushP);
  }

  private broadcast(traceId: string, ownerId: string, event: TraceLiveEvent): void {
    const subs = this.subscribers.get(`${traceId}::${ownerId}`);
    if (!subs) return;
    for (const sub of subs) sub.push(event);
  }
}
```

### Step 1.3: Run tests — expect PASS

```bash
cd packages/worker
pnpm test trace-registry
```

Expected: all 7 tests pass.

### Step 1.4: Commit

```bash
git add packages/worker/src/trace-registry.ts packages/worker/src/__tests__/trace-registry.test.ts
git commit -m "$(cat <<'EOF'
worker(trace-registry): in-memory TraceRegistry with async flush + live tail

Process-wide trace state with two responsibilities: (1) subscribe channels
for SSE live tail subscribers, (2) async-batched writes to TraceStore
(100 spans or 250ms, whichever first). Backpressure drops tool spans first
when a per-owner buffer hits 10k. Mirrors the RunRegistry pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `SpanEmitter` primitive (refactor `telemetry.ts`)

This is the largest single refactor in this slice. The existing `Telemetry` class wraps OTel; the new `SpanEmitter` adds (1) a per-trace stack so spans nest correctly across layers, (2) a `TraceSink` callback that bridges to `TraceRegistry`, and (3) new span kinds: `run`, `manifest`, `step`. The OTel sink stays as a parallel write path.

The runner currently calls `this.telemetry.startInvoke(...)` and uses returned span handles (`InvokeSpan`, `ModelCallSpan`, `ToolCallSpan`). We keep that handle shape so `runner.ts` changes are minimal, but make the handles emit to the new sink in addition to OTel.

**Files:**
- Modify: `packages/core/src/telemetry.ts`
- Modify: `packages/core/src/types.ts` (add `TraceSink`, extend `InvokeOptions` and `RunnerConfig`)
- Create: `packages/core/src/__tests__/span-emitter.test.ts`

### Step 2.1: Add `TraceSink` to core types

Open `packages/core/src/types.ts`. Find the Traces section (where `TraceLiveEvent`, `TraceStore` were added in Slice 1). Just below `TraceLiveEvent`, add:

```ts
/**
 * Callback the SpanEmitter calls on every span-start / span-end / trace-done.
 * The TraceRegistry implements this; pass it via `RunnerConfig.telemetry.traceSink`.
 */
export type TraceSink = (event: TraceLiveEvent) => void;
```

In the same file, find `InvokeOptions` (around line 127) and add an optional field:

```ts
  /** Per-invocation SpanEmitter. When provided, child spans nest under whatever
   *  span is at the top of its stack. Bridge constructs one per request. */
  spanEmitter?: import("./telemetry.js").SpanEmitter;
```

In `RunnerConfig`, the existing `telemetry` field is an optional `TelemetryConfig`. Extend `TelemetryConfig` in `telemetry.ts` (next step) — the type lives there.

### Step 2.2: Refactor `telemetry.ts` — new `SpanEmitter`

Replace the entirety of `packages/core/src/telemetry.ts` with the new shape. Read the existing file first to keep all OTel handling intact:

```bash
cat packages/core/src/telemetry.ts
```

The refactor preserves: the OTel dynamic import, the `recordIO`/`recordToolIO`/`baseAttributes` config, and the public handle shapes (`InvokeSpan`, `ModelCallSpan`, `ToolCallSpan`). It adds: a per-trace stack, three new span kinds (`run`, `manifest`, `step`), and a `TraceSink` callback that produces `TraceLiveEvent`s.

Replace the file with:

```ts
import type { TokenUsage, ToolCallRecord, Span, SpanKind, TraceSink, TraceLiveEvent } from "./types.js";

// ───────────────────────────────────────────────────────────────────────
// OTel passthrough — unchanged from prior slice
// ───────────────────────────────────────────────────────────────────────

export interface OTelTracer {
  startSpan(name: string, options?: OTelSpanOptions, context?: unknown): OTelSpan;
}
export interface OTelSpan {
  setAttribute(key: string, value: string | number | boolean): this;
  setStatus(status: { code: number; message?: string }): this;
  recordException(exception: Error | string): void;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}
export interface OTelSpanOptions {
  kind?: number;
  attributes?: Record<string, string | number | boolean>;
}

let otelApi: any = null;
function getOTelApi(): any {
  if (otelApi === undefined) return null;
  if (otelApi !== null) return otelApi;
  try {
    otelApi = require("@opentelemetry/api");
    return otelApi;
  } catch {
    otelApi = undefined;
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// SpanEmitter config
// ───────────────────────────────────────────────────────────────────────

export interface TelemetryConfig {
  /** Optional OTel tracer for export-only forwarding. */
  tracer?: OTelTracer;
  /** Tracer name for global tracer lookup. Default "agntz". */
  tracerName?: string;
  /** Whether to include input/output text in span attributes. Default false. */
  recordIO?: boolean;
  /** Whether to include tool call inputs/outputs. Default false. */
  recordToolIO?: boolean;
  /** Static attributes applied to every span. */
  baseAttributes?: Record<string, string | number | boolean>;
  /** Native sink — invoked on every span-start / span-end / trace-done. */
  traceSink?: TraceSink;
}

// ───────────────────────────────────────────────────────────────────────
// Span handles — same outward shape as the prior Telemetry class
// ───────────────────────────────────────────────────────────────────────

export interface RunSpan {
  end(): void;
  error(err: Error | string): void;
}
export interface ManifestSpan {
  step(params: { name: string; index: number }): StepSpan;
  end(): void;
  error(err: Error | string): void;
}
export interface StepSpan {
  end(): void;
  error(err: Error | string): void;
}
export interface InvokeSpan {
  modelCall(params: { model: string; step: number }): ModelCallSpan;
  toolCall(params: { toolName: string; toolCallId: string }): ToolCallSpan;
  setResult(result: { output?: string; usage: TokenUsage; duration: number; toolCallCount: number; stepCount: number }): void;
  end(): void;
  error(err: Error | string): void;
}
export interface ModelCallSpan {
  setResult(result: { usage: TokenUsage; finishReason?: string; toolCallCount: number; costUsd?: number }): void;
  end(): void;
  error(err: Error | string): void;
}
export interface ToolCallSpan {
  setResult(record: ToolCallRecord): void;
  end(): void;
  error(err: Error | string): void;
}

// ───────────────────────────────────────────────────────────────────────
// SpanEmitter — stack-based parentage + dual sinks
// ───────────────────────────────────────────────────────────────────────

/**
 * Threaded per-request through ExecutionContext + InvokeOptions. Maintains
 * a per-trace stack of active spans so cross-layer parent linkage works
 * without explicit threading.
 */
export class SpanEmitter {
  private config: TelemetryConfig;
  private tracer: OTelTracer | null;
  private otelStack: OTelSpan[] = [];
  private stack: Array<{ spanId: string; traceId: string; ownerId: string; runId: string | null; sessionId: string | null }> = [];

  constructor(config: TelemetryConfig = {}) {
    this.config = config;
    if (config.tracer) {
      this.tracer = config.tracer;
    } else if (config) {
      const api = getOTelApi();
      this.tracer = api ? api.trace.getTracer(config.tracerName ?? "agntz") : null;
    } else {
      this.tracer = null;
    }
  }

  /** Returns true iff at least one sink is active (OTel or native). */
  get enabled(): boolean {
    return this.tracer !== null || this.config.traceSink !== undefined;
  }

  startRun(params: { ownerId: string; runId: string; sessionId?: string | null; agentId: string }): RunSpan {
    const span = this.openSpan("run", "agent.run", {
      ownerId: params.ownerId,
      runId: params.runId,
      sessionId: params.sessionId ?? null,
      attrs: { "agent.id": params.agentId, "agent.run.id": params.runId },
    });
    return {
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  startManifest(params: { ownerId: string; agentId: string; kind: string; runId?: string | null; sessionId?: string | null }): ManifestSpan {
    const span = this.openSpan("manifest", "agent.manifest", {
      ownerId: params.ownerId,
      runId: params.runId ?? null,
      sessionId: params.sessionId ?? null,
      attrs: { "agent.id": params.agentId, "manifest.kind": params.kind },
    });
    return {
      step: (sp) => this.startStepInternal(sp, span),
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  startStep(params: { name: string; index: number; ownerId: string; runId?: string | null }): StepSpan {
    const span = this.openSpan("step", "agent.step", {
      ownerId: params.ownerId,
      runId: params.runId ?? null,
      sessionId: null,
      attrs: { "step.name": params.name, "step.index": params.index },
    });
    return {
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  startInvoke(params: { agentId: string; invocationId: string; model: string; ownerId: string; sessionId?: string | null; runId?: string | null; input?: string }): InvokeSpan {
    const attrs: Record<string, string | number | boolean> = {
      "agent.id": params.agentId,
      "agent.invocation.id": params.invocationId,
      "agent.model": params.model,
      ...this.config.baseAttributes,
    };
    if (params.sessionId) attrs["agent.session.id"] = params.sessionId;
    if (params.runId) attrs["agent.run.id"] = params.runId;
    if (this.config.recordIO && params.input) attrs["agent.input"] = params.input.slice(0, 4096);

    const span = this.openSpan("invoke", "agent.invoke", {
      ownerId: params.ownerId,
      runId: params.runId ?? null,
      sessionId: params.sessionId ?? null,
      attrs,
    });

    const handle = this;
    return {
      modelCall: (mp) => handle.startModelCallInternal(mp, span),
      toolCall: (tp) => handle.startToolCallInternal(tp, span),
      setResult: (result) => handle.setInvokeResultInternal(span, result),
      end: () => handle.closeSpan(span, "ok"),
      error: (err) => handle.closeSpan(span, "error", err),
    };
  }

  // ─── private helpers ─────

  private startStepInternal(params: { name: string; index: number }, parent: SpanState): StepSpan {
    const span = this.openSpan("step", "agent.step", {
      ownerId: parent.ownerId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      attrs: { "step.name": params.name, "step.index": params.index },
      explicitParent: parent,
    });
    return {
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  private startModelCallInternal(params: { model: string; step: number }, parent: SpanState): ModelCallSpan {
    const span = this.openSpan("model", "agent.model.call", {
      ownerId: parent.ownerId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      attrs: { "agent.model": params.model, "agent.step": params.step },
      explicitParent: parent,
    });
    return {
      setResult: (r) => this.setModelResult(span, r),
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  private startToolCallInternal(params: { toolName: string; toolCallId: string }, parent: SpanState): ToolCallSpan {
    const span = this.openSpan("tool", "agent.tool.execute", {
      ownerId: parent.ownerId,
      runId: parent.runId,
      sessionId: parent.sessionId,
      attrs: { "agent.tool.name": params.toolName, "agent.tool.call.id": params.toolCallId },
      explicitParent: parent,
    });
    return {
      setResult: (record) => this.setToolResult(span, record),
      end: () => this.closeSpan(span, "ok"),
      error: (err) => this.closeSpan(span, "error", err),
    };
  }

  private openSpan(kind: SpanKind, name: string, opts: OpenOpts): SpanState {
    const parent = opts.explicitParent ?? (this.stack.length > 0 ? this.stack[this.stack.length - 1] : null);
    const traceId = parent ? parent.traceId : `tr_${ulid()}`;
    const spanId = `sp_${ulid()}`;
    const startedAt = new Date().toISOString();

    const state: SpanState = {
      spanId,
      traceId,
      parentId: parent ? parent.spanId : null,
      ownerId: opts.ownerId,
      runId: opts.runId,
      sessionId: opts.sessionId,
      kind,
      name,
      startedAt,
      attrs: opts.attrs ?? {},
      otel: this.tracer ? this.tracer.startSpan(name, { attributes: opts.attrs ?? {} }) : null,
    };

    // Only push to stack if NOT using an explicit parent — explicit-parent spans
    // are siblings, not nested children of whatever's currently on top.
    if (!opts.explicitParent) this.stack.push({ spanId, traceId, ownerId: opts.ownerId, runId: opts.runId, sessionId: opts.sessionId });

    if (this.config.traceSink) {
      const span: Span = stateToSpan(state, "running");
      this.config.traceSink({ type: "span-start", span });
    }

    return state;
  }

  private closeSpan(state: SpanState, status: "ok" | "error", err?: Error | string): void {
    const endedAt = new Date().toISOString();
    const durationMs = new Date(endedAt).getTime() - new Date(state.startedAt).getTime();
    state.endedAt = endedAt;
    state.durationMs = durationMs;
    state.status = status;
    if (status === "error" && err) {
      state.error = err instanceof Error ? err.message : err;
    }

    if (state.otel) {
      state.otel.setStatus({ code: status === "ok" ? 1 : 2, message: state.error ?? undefined });
      if (err instanceof Error) state.otel.recordException(err);
      state.otel.end();
    }

    if (this.config.traceSink) {
      this.config.traceSink({
        type: "span-end",
        spanId: state.spanId,
        patch: { endedAt, durationMs, status, error: state.error ?? null, attributes: state.attrs },
      });
    }

    // Pop our stack frame if this was a stack-managed span.
    const top = this.stack[this.stack.length - 1];
    if (top && top.spanId === state.spanId) this.stack.pop();
  }

  private setInvokeResultInternal(state: SpanState, result: { output?: string; usage: TokenUsage; duration: number; toolCallCount: number; stepCount: number }): void {
    state.attrs["agent.usage.prompt_tokens"] = result.usage.promptTokens;
    state.attrs["agent.usage.completion_tokens"] = result.usage.completionTokens;
    state.attrs["agent.usage.total_tokens"] = result.usage.totalTokens;
    state.attrs["agent.duration_ms"] = result.duration;
    state.attrs["agent.tool_call_count"] = result.toolCallCount;
    state.attrs["agent.step_count"] = result.stepCount;
    if (this.config.recordIO && result.output) state.attrs["agent.output"] = result.output.slice(0, 4096);
    if (state.otel) {
      for (const [k, v] of Object.entries(state.attrs)) state.otel.setAttribute(k, v as string | number | boolean);
    }
  }

  private setModelResult(state: SpanState, r: { usage: TokenUsage; finishReason?: string; toolCallCount: number; costUsd?: number }): void {
    state.attrs["agent.usage.prompt_tokens"] = r.usage.promptTokens;
    state.attrs["agent.usage.completion_tokens"] = r.usage.completionTokens;
    state.attrs["agent.usage.total_tokens"] = r.usage.totalTokens;
    state.attrs["agent.tool_call_count"] = r.toolCallCount;
    if (r.finishReason) state.attrs["agent.finish_reason"] = r.finishReason;
    if (typeof r.costUsd === "number") state.attrs["agent.cost_usd"] = r.costUsd;
    if (state.otel) {
      for (const [k, v] of Object.entries(state.attrs)) state.otel.setAttribute(k, v as string | number | boolean);
    }
  }

  private setToolResult(state: SpanState, record: ToolCallRecord): void {
    state.attrs["agent.tool.duration_ms"] = record.duration;
    if (record.error) state.attrs["agent.tool.error"] = record.error;
    if (this.config.recordToolIO) {
      state.attrs["agent.tool.input"] = JSON.stringify(record.input).slice(0, 4096);
      state.attrs["agent.tool.output"] = JSON.stringify(record.output).slice(0, 4096);
    }
    if (state.otel) {
      for (const [k, v] of Object.entries(state.attrs)) state.otel.setAttribute(k, v as string | number | boolean);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// Backward-compat: Telemetry class re-exports SpanEmitter under the old name
// ───────────────────────────────────────────────────────────────────────

export class Telemetry extends SpanEmitter {}

// ───────────────────────────────────────────────────────────────────────
// Internal types
// ───────────────────────────────────────────────────────────────────────

interface SpanState {
  spanId: string;
  traceId: string;
  parentId: string | null;
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  kind: SpanKind;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status?: "ok" | "error";
  error?: string | null;
  attrs: Record<string, string | number | boolean>;
  otel: OTelSpan | null;
}

interface OpenOpts {
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  attrs?: Record<string, string | number | boolean>;
  /** If set, parent is this state directly (used by `manifest.step()` returns). */
  explicitParent?: SpanState;
}

function stateToSpan(s: SpanState, status: "running" | "ok" | "error" | "cancelled"): Span {
  return {
    spanId: s.spanId,
    traceId: s.traceId,
    parentId: s.parentId,
    ownerId: s.ownerId,
    runId: s.runId,
    sessionId: s.sessionId,
    name: s.name,
    kind: s.kind,
    startedAt: s.startedAt,
    endedAt: s.endedAt ?? null,
    durationMs: s.durationMs ?? null,
    status,
    error: s.error ?? null,
    attributes: { ...s.attrs },
    events: [],
    scores: {},
    costUsd: typeof s.attrs["agent.cost_usd"] === "number" ? s.attrs["agent.cost_usd"] as number : null,
  };
}

// ULID — short, sortable, URL-safe ID. Reuse the same approach the recent runId work used.
function ulid(): string {
  // 26-char Crockford base32; for tests/dev we can use a simple variant:
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}
```

### Step 2.3: Write unit tests for `SpanEmitter`

Create `packages/core/src/__tests__/span-emitter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SpanEmitter } from "../telemetry.js";
import type { TraceLiveEvent } from "../types.js";

function withEmitter(): { emitter: SpanEmitter; events: TraceLiveEvent[] } {
  const events: TraceLiveEvent[] = [];
  const emitter = new SpanEmitter({ traceSink: (e) => events.push(e) });
  return { emitter, events };
}

describe("SpanEmitter", () => {
  it("startInvoke emits span-start with traceId and no parent", () => {
    const { emitter, events } = withEmitter();
    const s = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    s.end();
    expect(events).toHaveLength(2);
    const start = events[0] as { type: string; span: { traceId: string; parentId: string | null; kind: string } };
    expect(start.type).toBe("span-start");
    expect(start.span.kind).toBe("invoke");
    expect(start.span.parentId).toBeNull();
    expect(start.span.traceId).toMatch(/^tr_/);
  });

  it("nested manifest > invoke threads parentId and shares traceId", () => {
    const { emitter, events } = withEmitter();
    const m = emitter.startManifest({ ownerId: "u1", agentId: "a1", kind: "llm" });
    const inv = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    inv.end();
    m.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { traceId: string; parentId: string | null; spanId: string; kind: string } }>;
    expect(starts).toHaveLength(2);
    expect(starts[0].span.kind).toBe("manifest");
    expect(starts[1].span.kind).toBe("invoke");
    expect(starts[1].span.parentId).toBe(starts[0].span.spanId);
    expect(starts[1].span.traceId).toBe(starts[0].span.traceId);
  });

  it("model.call and tool.execute spans nest under invoke as explicit children", () => {
    const { emitter, events } = withEmitter();
    const inv = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    const mc = inv.modelCall({ model: "claude-sonnet-4-6", step: 1 });
    mc.end();
    const tc = inv.toolCall({ toolName: "read_file", toolCallId: "tc_1" });
    tc.end();
    inv.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { kind: string; parentId: string | null; spanId: string } }>;
    expect(starts.map((s) => s.span.kind)).toEqual(["invoke", "model", "tool"]);
    expect(starts[1].span.parentId).toBe(starts[0].span.spanId);
    expect(starts[2].span.parentId).toBe(starts[0].span.spanId);
  });

  it("span-end carries patch with status, duration, error", () => {
    const { emitter, events } = withEmitter();
    const inv = emitter.startInvoke({ agentId: "a1", invocationId: "i1", model: "m", ownerId: "u1" });
    inv.error(new Error("boom"));
    const end = events.find((e) => e.type === "span-end") as { type: string; patch: { status: string; error: string | null; durationMs: number | null } };
    expect(end.patch.status).toBe("error");
    expect(end.patch.error).toBe("boom");
    expect(end.patch.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("with no traceSink and no OTel, emit() calls are no-ops (no throw)", () => {
    const emitter = new SpanEmitter();
    expect(() => {
      const s = emitter.startInvoke({ agentId: "a", invocationId: "i", model: "m", ownerId: "u1" });
      s.end();
    }).not.toThrow();
  });

  it("ownerId is preserved through nested spans", () => {
    const { emitter, events } = withEmitter();
    const m = emitter.startManifest({ ownerId: "u_special", agentId: "a", kind: "llm" });
    const inv = emitter.startInvoke({ agentId: "a", invocationId: "i", model: "m", ownerId: "u_special" });
    inv.end();
    m.end();
    const starts = events.filter((e) => e.type === "span-start") as Array<{ span: { ownerId: string } }>;
    for (const s of starts) expect(s.span.ownerId).toBe("u_special");
  });
});
```

### Step 2.4: Run tests — expect PASS

```bash
cd packages/core
pnpm test span-emitter
```

Expected: all 6 tests pass.

### Step 2.5: Run the full core test suite — confirm no regressions

```bash
cd packages/core
pnpm test
```

Expected: existing tests pass (memory/json conformance still green; runner tests still green because the old `Telemetry` class signature is preserved via `class Telemetry extends SpanEmitter {}`).

### Step 2.6: Commit

```bash
git add packages/core/src/telemetry.ts packages/core/src/types.ts packages/core/src/__tests__/span-emitter.test.ts
git commit -m "$(cat <<'EOF'
core(telemetry): refactor Telemetry → SpanEmitter with stack-based parentage

The new SpanEmitter holds a per-trace stack of active spans so cross-layer
parent linkage works without explicit threading. Adds run/manifest/step span
kinds alongside the existing invoke/model/tool. Dual sinks: TraceSink
callback (native — writes to TraceRegistry) and the existing OTel passthrough.
Telemetry class is preserved as a backward-compat alias so runner.ts call
sites don't churn.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `SpanEmitter` through `ExecutionContext` and `InvokeOptions`

This task plumbs the `SpanEmitter` from the bridge → executor → runner so every layer's `start*` calls share the same instance (and therefore the same trace stack).

**Files:**
- Modify: `packages/manifest/src/types.ts`
- Modify: `packages/worker/src/bridge.ts`
- Modify: `packages/worker/src/routes.ts`
- Modify: `packages/core/src/runner.ts` (constructor + invoke arg passthrough)

### Step 3.1: Add `spanEmitter` to `ExecutionContext`

Open `packages/manifest/src/types.ts`. Find the `ExecutionContext` interface (search for `export interface ExecutionContext`). Add one optional field:

```ts
  /** Per-request span emitter — used by executor and pipelines to wrap manifest
   *  and step lifecycles with spans. Null/undefined disables emission. */
  spanEmitter?: import("@agntz/core").SpanEmitter;
```

Add `SpanEmitter` to the public exports from `@agntz/core`. Open `packages/core/src/index.ts`. Find the existing `export type { ... }` block that exports Run/TraceStore types. Add:

```ts
export { SpanEmitter, Telemetry } from "./telemetry.js";
export type { TelemetryConfig, RunSpan, ManifestSpan, StepSpan, InvokeSpan, ModelCallSpan, ToolCallSpan, TraceSink } from "./telemetry.js";
```

NOTE: `Telemetry` was already an export — keep that line and add the others.

### Step 3.2: Construct `SpanEmitter` in the bridge

Open `packages/worker/src/bridge.ts`. Modify `CreateExecutionContextOptions`:

```ts
export interface CreateExecutionContextOptions {
  runRegistry?: RunRegistry;
  /** Optional span emitter. Construct one per request in the worker route. */
  spanEmitter?: import("@agntz/core").SpanEmitter;
}
```

Modify `createExecutionContext` to thread `spanEmitter` into the returned `ExecutionContext` AND pass it to `runner.invoke`:

```ts
export function createExecutionContext(
  runner: Runner,
  options: CreateExecutionContextOptions = {},
): ExecutionContext {
  const { runRegistry, spanEmitter } = options;
  return {
    spanEmitter,  // ← new line
    resolveAgent: async (id: string) => { /* unchanged */ },
    invokeLLM: async (manifest, renderedInstruction, state) => {
      // …existing logic…
      const result = await runner.invoke(tempId, userInput, {
        runRegistry,
        spanEmitter,  // ← new field on InvokeOptions
      });
      // …existing logic…
    },
    invokeTool: async (config, state) => { /* unchanged */ },
  };
}
```

### Step 3.3: Construct `SpanEmitter` per request in worker routes

Open `packages/worker/src/routes.ts`. Find where `/run` and `/run/stream` build their per-request `ExecutionContext` (search for `createExecutionContext(runner`). The current code probably builds just `{ sessionId }` or similar. Modify to also build a `SpanEmitter` that writes to the process-wide `TraceRegistry`:

```ts
import { SpanEmitter } from "@agntz/core";
import { InMemoryTraceRegistry } from "./trace-registry.js";

// At module load, create the process-wide registry (similar pattern to RunRegistry).
// The registry accepts a single TraceStore at construction; per-tenant scoping
// happens via the store's existing owner_id columns, so we don't need a per-owner
// store factory.
const traceRegistry = new InMemoryTraceRegistry({
  store: /* the unified store the worker constructs at startup */ store,
});

// In each route handler, after resolving the per-user runner + store:
const spanEmitter = new SpanEmitter({
  traceSink: (event) => {
    // Route TraceLiveEvent → TraceRegistry method
    if (event.type === "span-start") traceRegistry.spanStart(event.span);
    else if (event.type === "span-end") traceRegistry.spanEnd(event.spanId, event.patch);
    else if (event.type === "trace-done") traceRegistry.traceDone(event.summary.traceId, event.summary.ownerId, event.summary);
  },
  recordIO: false,  // default off per spec
});

const ctx = createExecutionContext(runner, { runRegistry, spanEmitter });
```

Construct the `TraceRegistry` at module load (once per worker process), passing the unified Postgres/SQLite/etc. store as the backing TraceStore. The trace registry is process-wide — same lifetime as `RunRegistry`.

### Step 3.4: Accept `spanEmitter` on `InvokeOptions` and pass to runner

Open `packages/core/src/runner.ts`. In the `invoke()` method signature (search for `async invoke`), the existing code reads `options: InvokeOptions = {}`. Add a destructure inside the body:

```ts
const spanEmitter = options.spanEmitter ?? this.telemetry;
```

Then change every existing `this.telemetry.startInvoke(...)`, `this.telemetry.startModelCall(...)`, etc. to use `spanEmitter` instead. (Use grep to find every call site:)

```bash
grep -n "this.telemetry\." packages/core/src/runner.ts
```

For each match, replace `this.telemetry` with the local `spanEmitter` constant. The constructor's `this.telemetry = new Telemetry(config.telemetry)` stays as the **default fallback** — when `InvokeOptions.spanEmitter` is not provided, the runner uses its own per-runner emitter (which is the legacy v1 behavior).

Apply the same change to `stream()` (the streaming variant of invoke).

### Step 3.5: Verify typecheck

```bash
cd packages/core && pnpm typecheck
cd packages/manifest && pnpm typecheck
cd packages/worker && pnpm typecheck
```

Expected: all pass. The `ExecutionContext` interface change ripples through the manifest layer; any TypeScript errors are real and must be fixed.

### Step 3.6: Run all tests

```bash
pnpm test
```

Expected: all pass. The wiring is a passthrough — no behavior change yet.

### Step 3.7: Commit

```bash
git add packages/core/src/runner.ts packages/core/src/index.ts packages/manifest/src/types.ts packages/worker/src/bridge.ts packages/worker/src/routes.ts
git commit -m "$(cat <<'EOF'
worker+manifest+core: thread SpanEmitter through ExecutionContext

Bridge constructs a SpanEmitter per request, wires it into the returned
ExecutionContext, and passes it via InvokeOptions.spanEmitter so executor
and runner share the same trace stack. Process-wide TraceRegistry receives
all span events. The runner's own this.telemetry stays as a fallback for
SDK consumers who haven't migrated. No behavior change yet — spans aren't
opened at new sites until tasks 4-6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Open `manifest` and `step` spans in executor and pipelines

**Files:**
- Modify: `packages/manifest/src/executor.ts`
- Modify: `packages/manifest/src/pipeline/sequential.ts`
- Modify: `packages/manifest/src/pipeline/parallel.ts`

### Step 4.1: Wrap `executeWithState` with a manifest span

Open `packages/manifest/src/executor.ts`. Modify `executeWithState`:

```ts
export async function executeWithState(
  manifest: AgentManifest,
  state: AgentState,
  ctx: ExecutionContext,
  parentInput: unknown
): Promise<ExecutionResult> {
  // Open a manifest span if an emitter is wired.
  const span = ctx.spanEmitter?.startManifest({
    ownerId: (ctx as { ownerId?: string }).ownerId ?? "",
    agentId: manifest.id,
    kind: manifest.kind,
  });
  try {
    let result: ExecutionResult;
    switch (manifest.kind) {
      case "llm":
        result = await executeLLM(manifest as LLMAgentManifest, state, ctx);
        break;
      case "tool":
        result = await executeTool(manifest as ToolAgentManifest, state, ctx);
        break;
      case "sequential":
        result = await executeSequential(manifest as SequentialAgentManifest, state, ctx, parentInput);
        break;
      case "parallel":
        result = await executeParallel(manifest as ParallelAgentManifest, state, ctx, parentInput);
        break;
      default:
        throw new Error(`Unknown agent kind: ${(manifest as AgentManifest).kind}`);
    }
    span?.end();
    return result;
  } catch (err) {
    span?.error(err as Error);
    throw err;
  }
}
```

NOTE: `(ctx as { ownerId?: string }).ownerId` is a temporary readthrough. In Slice 2.1 we should add `ownerId` to `ExecutionContext` properly; for now the cast preserves correctness without expanding the interface beyond what this task requires.

Actually — let's do it properly. Add `ownerId?: string` to `ExecutionContext` in `packages/manifest/src/types.ts`:

```ts
  /** Tenant scoping. Threaded from the worker request through to spans. */
  ownerId?: string;
```

Then in `bridge.ts`, thread it in via `CreateExecutionContextOptions`:

```ts
export interface CreateExecutionContextOptions {
  runRegistry?: RunRegistry;
  spanEmitter?: import("@agntz/core").SpanEmitter;
  ownerId?: string;
}
```

And in `createExecutionContext`:

```ts
return {
  spanEmitter,
  ownerId,
  resolveAgent: …,
  …
};
```

And in `routes.ts`, pass `ownerId: userId` (or whatever the resolved owner is) when calling `createExecutionContext(runner, { runRegistry, spanEmitter, ownerId: userId })`.

The executor then uses `ctx.ownerId ?? ""` (string fallback).

### Step 4.2: Wrap each sequential step with a step span

Open `packages/manifest/src/pipeline/sequential.ts`. Modify the inner `for` loop to wrap each step:

```ts
    for (let i = 0; i < manifest.steps.length; i++) {
      const step = manifest.steps[i];

      // Check when condition
      if (step.when && !evaluateCondition(step.when, state)) {
        const key = getStateKey(step);
        state[key] = null;
        previousOutput = null;
        continue;
      }

      const childManifest = await resolveStepAgent(step, ctx);
      const childInput = applyInputTransform(step.input, state, previousOutput);
      const childState = createInitialState(childInput, childManifest.inputSchema);

      const stepSpan = ctx.spanEmitter?.startStep({
        name: getStateKey(step),
        index: i,
        ownerId: ctx.ownerId ?? "",
      });
      try {
        const result = await executeWithState(childManifest, childState, ctx, childInput);
        stepSpan?.end();
        const key = getStateKey(step);
        state[key] = result.output;
        previousOutput = result.output;
      } catch (err) {
        stepSpan?.error(err as Error);
        throw err;
      }
    }
```

### Step 4.3: Wrap each parallel branch with a step span

Open `packages/manifest/src/pipeline/parallel.ts`. Modify the `branchPromises` map:

```ts
  const branchPromises = manifest.branches.map(async (step, index) => {
    const childManifest = await resolveStepAgent(step, ctx);
    const childInput = applyInputTransform(step.input, state, parentInput);
    const childState = createInitialState(childInput, childManifest.inputSchema);

    const stepSpan = ctx.spanEmitter?.startStep({
      name: getStateKey(step),
      index,
      ownerId: ctx.ownerId ?? "",
    });
    try {
      const result = await executeWithState(childManifest, childState, ctx, childInput);
      stepSpan?.end();
      const key = getStateKey(step);
      return { key, output: result.output };
    } catch (err) {
      stepSpan?.error(err as Error);
      throw err;
    }
  });
```

### Step 4.4: Run tests

```bash
pnpm test
```

Expected: all pass. No new tests yet — Task 7 has end-to-end span-tree assertions.

### Step 4.5: Commit

```bash
git add packages/manifest/src/types.ts packages/manifest/src/executor.ts packages/manifest/src/pipeline/sequential.ts packages/manifest/src/pipeline/parallel.ts packages/worker/src/bridge.ts packages/worker/src/routes.ts
git commit -m "$(cat <<'EOF'
manifest: emit manifest + step spans through ExecutionContext

executeWithState opens a manifest span around the dispatch; sequential and
parallel pipelines open a step span around each child invocation. ownerId
flows through ExecutionContext from the worker request. No-op when
spanEmitter is absent (e.g., direct SDK usage outside the worker).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Emit `run` spans from `RunRegistry`

The Run lifecycle is the outermost wrapper for top-level invocations. When a Run is created and started, a `run` kind span opens; when it completes or errors, the span closes.

**Files:**
- Modify: `packages/core/src/run-registry.ts`

### Step 5.1: Add `spanEmitter` to `RunRegistry` construction

The `InMemoryRunRegistry` is constructed in worker code (see `packages/worker/src/routes.ts`). Make `spanEmitter` an optional dependency injected at construction:

Open `packages/core/src/run-registry.ts`. Find the constructor of `InMemoryRunRegistry`:

```bash
grep -n "constructor\|InMemoryRunRegistry" packages/core/src/run-registry.ts | head -10
```

Add an optional `spanEmitter` to its options. In whatever options shape it accepts, add:

```ts
  /** Optional SpanEmitter for emitting run-kind spans on lifecycle events. */
  spanEmitter?: SpanEmitter;
```

Store it on the instance:

```ts
  private spanEmitter?: SpanEmitter;
```

### Step 5.2: Emit run-span on `start`, close on terminal events

In `create` or `start` (whichever is the canonical entry point for a top-level Run — start is the one with `executor: RunExecutor`):

```ts
start(run: Run, executor: RunExecutor): void {
  // ...existing logic, then:
  const runSpan = this.spanEmitter?.startRun({
    ownerId: run.userId ?? "",
    runId: run.id,
    sessionId: run.sessionId,
    agentId: run.agentId,
  });
  // Stash the handle so notifyCompleted / notifyFailed can close it.
  this.runSpans?.set(run.id, runSpan);
  // ...existing logic continues
}

notifyCompleted(runId: string, result: InvokeResult): void {
  // ...existing logic, then:
  this.runSpans?.get(runId)?.end();
  this.runSpans?.delete(runId);
}

notifyFailed(runId: string, err: unknown): void {
  // ...existing logic, then:
  const message = err instanceof Error ? err.message : String(err);
  this.runSpans?.get(runId)?.error(message);
  this.runSpans?.delete(runId);
}
```

Add `runSpans?: Map<string, RunSpan>` as a class field initialized in the constructor when `spanEmitter` is provided:

```ts
  private runSpans?: Map<string, RunSpan>;

  constructor(opts: ...) {
    // ...
    this.spanEmitter = opts.spanEmitter;
    if (this.spanEmitter) this.runSpans = new Map();
  }
```

Add the import:

```ts
import type { SpanEmitter, RunSpan } from "./telemetry.js";
```

NOTE: Only top-level Runs get a `run` span. Child Runs (spawned via `spawn_agent`) are nested under their parent's tool.execute span via the existing invoke→tool→invoke recursion — the spanEmitter's stack already handles that.

### Step 5.3: Pass `spanEmitter` when constructing `InMemoryRunRegistry`

Open `packages/worker/src/routes.ts` (or wherever `new InMemoryRunRegistry({...})` lives). Pass the per-request `spanEmitter`:

Actually — the `RunRegistry` is process-wide, not per-request. But each `RunRegistry.start(run, executor)` call happens in the context of one request's `spanEmitter`. The simplest model: store a per-run `spanEmitter` on the Run record at `create` time (passed by the caller), and use it on `notifyCompleted`/`notifyFailed`.

Modify the `SpawnRunOptions` shape (in `packages/core/src/types.ts`):

```ts
export interface SpawnRunOptions {
  agentId: string;
  input: string;
  parentRunId?: string;
  spawnToolUseId?: string;
  userId?: string;
  sessionId?: string;
  /** Optional per-run span emitter for emitting run-kind spans. */
  spanEmitter?: SpanEmitter;
}
```

And in `RunRegistry.create()`, stash it on a side-map keyed by `runId`:

```ts
  private runEmitters?: Map<string, SpanEmitter>;
  private runSpans?: Map<string, RunSpan>;

  create(opts: SpawnRunOptions): Run {
    // ...existing creation logic...
    if (opts.spanEmitter) {
      this.runEmitters ??= new Map();
      this.runEmitters.set(run.id, opts.spanEmitter);
    }
    return run;
  }

  start(run: Run, executor: RunExecutor): void {
    // ...
    const emitter = this.runEmitters?.get(run.id);
    if (emitter) {
      this.runSpans ??= new Map();
      this.runSpans.set(run.id, emitter.startRun({
        ownerId: run.userId ?? "",
        runId: run.id,
        sessionId: run.sessionId,
        agentId: run.agentId,
      }));
    }
    // ...existing logic
  }
```

Drop the registry-level `spanEmitter` field — emitters are per-run.

In `packages/worker/src/routes.ts`, when building a `RunRegistry.create()` call, pass `spanEmitter`:

```ts
const run = runRegistry.create({ agentId, input, userId, sessionId, spanEmitter });
```

### Step 5.4: Run tests

```bash
pnpm test
```

Expected: all pass. Run spans now emit but no integration test yet — Task 7 verifies.

### Step 5.5: Commit

```bash
git add packages/core/src/run-registry.ts packages/core/src/types.ts packages/worker/src/routes.ts
git commit -m "$(cat <<'EOF'
core(run-registry): emit run-kind spans on Run lifecycle

Each Run's per-request SpanEmitter is stashed at create() and used at
start() to open a run-kind span. notifyCompleted / notifyFailed close it.
Child runs (spawn_agent) nest under their parent's tool.execute via the
emitter's stack — no special handling needed for nesting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Cost computation at `model.call` span end

**Files:**
- Create: `packages/core/src/model-pricing.ts`
- Modify: `packages/core/src/runner.ts` (compute cost where `setResult` is called on the model span)

### Step 6.1: Create the per-model rate table

Create `packages/core/src/model-pricing.ts`:

```ts
import type { TokenUsage } from "./types.js";

/**
 * Per-model rates in USD per 1M tokens. Defaults bundled for major providers.
 * Customers can override per-deployment via the env hook (see overridesFromEnv).
 *
 * Sources: published 2026-05 list prices. Rates change; check provider docs
 * for production accuracy.
 */
export interface ModelRate {
  promptPer1M: number;     // USD per 1M input tokens
  completionPer1M: number; // USD per 1M output tokens
}

const DEFAULT_RATES: Record<string, ModelRate> = {
  "anthropic/claude-opus-4-7":     { promptPer1M: 15.00, completionPer1M: 75.00 },
  "anthropic/claude-sonnet-4-6":   { promptPer1M:  3.00, completionPer1M: 15.00 },
  "anthropic/claude-haiku-4-5":    { promptPer1M:  1.00, completionPer1M:  5.00 },
  "openai/gpt-5":                  { promptPer1M:  5.00, completionPer1M: 15.00 },
  "openai/gpt-5-mini":             { promptPer1M:  0.50, completionPer1M:  2.00 },
  "google/gemini-3-pro":           { promptPer1M:  3.00, completionPer1M: 15.00 },
};

/**
 * Compute cost in USD from token usage and a (provider, name) tuple.
 * Returns null when no rate is known — callers should not block on this.
 */
export function computeCost(usage: TokenUsage, provider: string, modelName: string): number | null {
  const key = `${provider}/${modelName}`;
  const rate = DEFAULT_RATES[key];
  if (!rate) return null;
  return (usage.promptTokens * rate.promptPer1M + usage.completionTokens * rate.completionPer1M) / 1_000_000;
}

/** Test seam — exposes the rate table for verification. */
export function _getRatesForTest(): Readonly<Record<string, ModelRate>> {
  return DEFAULT_RATES;
}
```

Add an export from `packages/core/src/index.ts`:

```ts
export { computeCost } from "./model-pricing.js";
```

### Step 6.2: Hook cost into runner.ts where model results are set

Search for where the runner sets the model result on the span:

```bash
grep -n "modelCallSpan\|model.call\.setResult\|modelSpan\.setResult\|usage:" packages/core/src/runner.ts | head -20
```

Find the call site that looks like `modelSpan.setResult({ usage, finishReason, toolCallCount })` (in both `invoke` and `stream`). Modify both to compute cost first:

```ts
import { computeCost } from "./model-pricing.js";

// In each call site where modelSpan.setResult is called:
const costUsd = computeCost(result.usage, modelConfig.provider, modelConfig.name);
modelSpan.setResult({
  usage: result.usage,
  finishReason: result.finishReason,
  toolCallCount: result.toolCalls?.length ?? 0,
  costUsd: costUsd ?? undefined,
});
```

The `setResult` signature on `ModelCallSpan` already accepts `costUsd?: number` (defined in Task 2). The emitter writes `agent.cost_usd` to the span's attributes; the persisted `Span.costUsd` field is filled in `stateToSpan` (already wired in Task 2).

### Step 6.3: Quick test for cost computation

Append to `packages/core/src/__tests__/span-emitter.test.ts`:

```ts
import { computeCost } from "../model-pricing.js";

describe("computeCost", () => {
  it("returns USD cost for known models", () => {
    const cost = computeCost({ promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 }, "anthropic", "claude-sonnet-4-6");
    expect(cost).toBe(3.00);
  });

  it("returns null for unknown models", () => {
    const cost = computeCost({ promptTokens: 100, completionTokens: 100, totalTokens: 200 }, "unknown", "model");
    expect(cost).toBeNull();
  });

  it("computes correctly for mixed token counts", () => {
    // claude-haiku-4-5: 1.00/M input, 5.00/M output
    const cost = computeCost({ promptTokens: 500_000, completionTokens: 100_000, totalTokens: 600_000 }, "anthropic", "claude-haiku-4-5");
    expect(cost).toBe(0.5 + 0.5); // 0.5 input + 0.5 output = 1.0 USD
  });
});
```

### Step 6.4: Run tests

```bash
cd packages/core
pnpm test
```

Expected: all pass, including 3 new cost tests.

### Step 6.5: Commit

```bash
git add packages/core/src/model-pricing.ts packages/core/src/runner.ts packages/core/src/index.ts packages/core/src/__tests__/span-emitter.test.ts
git commit -m "$(cat <<'EOF'
core(pricing): compute USD cost per model.call from token usage

New model-pricing.ts holds USD-per-million-tokens rates for major providers.
runner.ts computes cost at every modelSpan.setResult and surfaces it as
agent.cost_usd. The persisted Span.costUsd field is filled from the same
attribute. Returns null for unknown models — no blocking error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: End-to-end integration test

Verify the full span tree shape by running a small manifest through the real runner and inspecting the resulting trace in an in-memory store.

**Files:**
- Create: `packages/worker/tests/span-emission-e2e.test.ts`

### Step 7.1: Write the test

Create `packages/worker/tests/span-emission-e2e.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore, SpanEmitter, createRunner } from "@agntz/core";
import { execute } from "@agntz/manifest";
import { createExecutionContext } from "../src/bridge.js";
import { InMemoryTraceRegistry } from "../src/trace-registry.js";
import type { SequentialAgentManifest, TraceStore } from "@agntz/core";

/**
 * E2E: run a small two-step sequential manifest, assert the persisted span
 * tree has the right shape: manifest → step ×2 → invoke → model.call
 * (no actual model calls — the MockModelProvider returns canned responses.)
 */
describe("span emission end-to-end", () => {
  let store: MemoryStore;
  let traceStore: TraceStore;
  let registry: InMemoryTraceRegistry;
  let emitter: SpanEmitter;
  let runner: ReturnType<typeof createRunner>;

  beforeEach(() => {
    store = new MemoryStore();
    traceStore = store as unknown as TraceStore;
    registry = new InMemoryTraceRegistry({ store: traceStore, flushBatchSize: 1, flushIntervalMs: 50 });
    emitter = new SpanEmitter({
      traceSink: (event) => {
        if (event.type === "span-start") registry.spanStart(event.span);
        else if (event.type === "span-end") registry.spanEnd(event.spanId, event.patch);
        else if (event.type === "trace-done") registry.traceDone(event.summary.traceId, event.summary.ownerId, event.summary);
      },
    });
    runner = createRunner({
      store,
      // Stub the model provider so we don't hit a real API:
      modelProvider: {
        generateText: async () => ({
          text: "ok",
          toolCalls: [],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        }),
        streamText: async () => { throw new Error("not used"); },
      } as any,
    });
  });

  it("produces manifest > step > invoke > model.call hierarchy", async () => {
    const manifest: SequentialAgentManifest = {
      id: "test-seq",
      kind: "sequential",
      steps: [
        { agent: { id: "step1", kind: "llm", model: { provider: "anthropic", name: "claude-sonnet-4-6" }, instruction: "say hi" } },
        { agent: { id: "step2", kind: "llm", model: { provider: "anthropic", name: "claude-sonnet-4-6" }, instruction: "say bye" } },
      ],
    } as SequentialAgentManifest;

    const ctx = createExecutionContext(runner, { spanEmitter: emitter, ownerId: "u_e2e" });
    await execute(manifest, "input", ctx);
    await registry.waitForFlush();

    // Read the trace back. We need a traceId — listTraces gives us the summary.
    const list = await traceStore.listTraces({ ownerId: "u_e2e" });
    expect(list.rows.length).toBeGreaterThan(0);

    // For the e2e test, fetch all spans across the trace via the store.
    // (Since this is in-memory MemoryStore, we can iterate its backing map directly via getTrace.)
    const traceId = list.rows[0]?.traceId ?? "";
    const spans = await traceStore.getTrace(traceId, "u_e2e");

    // Group by kind.
    const byKind = spans.reduce((acc, s) => {
      (acc[s.kind] ??= []).push(s);
      return acc;
    }, {} as Record<string, typeof spans>);

    expect(byKind.manifest).toBeDefined();
    expect(byKind.step?.length).toBe(2);          // two steps in the sequential
    expect(byKind.invoke?.length).toBe(2);        // one invoke per step
    expect(byKind.model?.length).toBe(2);         // one model.call per invoke

    // Parent assertions: every step's parentId should be the manifest's spanId.
    const manifestSpan = byKind.manifest![0];
    for (const stepSpan of byKind.step!) {
      expect(stepSpan.parentId).toBe(manifestSpan.spanId);
    }
    // Each invoke's parent should be a step.
    const stepIds = new Set(byKind.step!.map((s) => s.spanId));
    for (const invoke of byKind.invoke!) {
      expect(stepIds.has(invoke.parentId ?? "")).toBe(true);
    }
  });

  it("model.call span carries cost_usd attribute when the model has a known rate", async () => {
    const manifest: SequentialAgentManifest = {
      id: "test-cost",
      kind: "sequential",
      steps: [
        { agent: { id: "step1", kind: "llm", model: { provider: "anthropic", name: "claude-haiku-4-5" }, instruction: "ping" } },
      ],
    } as SequentialAgentManifest;
    const ctx = createExecutionContext(runner, { spanEmitter: emitter, ownerId: "u_cost" });
    await execute(manifest, "in", ctx);
    await registry.waitForFlush();
    const list = await traceStore.listTraces({ ownerId: "u_cost" });
    const spans = await traceStore.getTrace(list.rows[0].traceId, "u_cost");
    const modelSpan = spans.find((s) => s.kind === "model")!;
    expect(modelSpan).toBeDefined();
    // haiku rate: 1/M input + 5/M output → 10 input * 1e-6 + 5 output * 5e-6 = 0.00001 + 0.000025 = 0.000035
    expect(modelSpan.costUsd).toBeGreaterThan(0);
    expect(modelSpan.costUsd).toBeLessThan(0.001);
  });
});
```

### Step 7.2: Run the e2e tests

```bash
cd packages/worker
pnpm test span-emission-e2e
```

Expected: both tests pass.

If they fail, the failure is the most informative signal in this slice — debug from the failure (likely cause: trace stack popping inconsistently, or a parent-child id mismatch from `explicitParent` semantics).

### Step 7.3: Run the full repo test suite

```bash
cd /Users/aaronparry/Developer/GymText/agntz
pnpm test
```

Expected: all packages pass.

### Step 7.4: Commit

```bash
git add packages/worker/tests/span-emission-e2e.test.ts
git commit -m "$(cat <<'EOF'
worker(test): end-to-end span emission tree assertion

Spins up a real runner + MemoryStore-backed TraceStore + InMemoryTraceRegistry,
runs a 2-step sequential manifest with a stub model provider, and verifies
the resulting span tree has the right shape: manifest > step ×2 > invoke
> model.call. Also verifies model.call.cost_usd is populated for known models.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Push branch + open PR

### Step 8.1: Final test pass and push

```bash
cd /Users/aaronparry/Developer/GymText/agntz
pnpm test
git push -u origin slice-5-span-emission
```

### Step 8.2: Open the PR

```bash
gh pr create --title "Tracing v1 Slice 2: span emission + TraceRegistry" --body "$(cat <<'EOF'
## Summary
- New `SpanEmitter` primitive (refactored from `telemetry.ts`) with stack-based parentage and three span kinds added: `run`, `manifest`, `step`. Dual sinks — native (TraceSink callback) + existing OpenTelemetry passthrough.
- New `TraceRegistry` in `@agntz/worker` — process-wide, in-memory, async batched writes to `TraceStore` (100 spans or 250ms), subscribe channels for live tail, backpressure caps tool spans first.
- Emission sites wired: `RunRegistry` emits `run` spans on Run lifecycle, `executor.ts` emits `manifest`, `pipeline/{sequential,parallel}.ts` emit `step` spans, `runner.ts` continues to emit `invoke`/`model.call`/`tool.execute`.
- Cost computation: new `packages/core/src/model-pricing.ts` rate table, `computeCost()` called at every `model.call` span end.
- End-to-end test verifies the full span tree shape.

Spec: `docs/superpowers/specs/2026-05-11-tracing-v1-design.md` (Sections 4, 6, 9).
Prior slice: PR #21 (merged).
Next slice: HTTP `/traces/*` routes + SDK `TracesResource` (Slice 3).

## Test plan
- [ ] `pnpm test` repo-wide — all packages pass
- [ ] `pnpm build` repo-wide — DTS emits cleanly
- [ ] End-to-end test: `packages/worker/tests/span-emission-e2e.test.ts` asserts `manifest > step ×2 > invoke > model.call` hierarchy
- [ ] Backward compat: `Telemetry` class still exported (alias of `SpanEmitter`); existing SDK consumers continue to work
- [ ] Verify against real Postgres: spans persist via TraceRegistry's async flush, `getTrace` returns the full tree

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- **Spec coverage:**
  - Section 6 (emit sites + TraceRegistry + async flush + backpressure) → Tasks 1, 4, 5
  - Section 6 (SpanEmitter dual sinks) → Task 2
  - Section 6 (trace ID propagation via emitter stack) → Task 2 + Task 3
  - Section 9 (cost computation) → Task 6
  - Section 9 (OTel sink survival) → Task 2 (Telemetry class alias preserved)
  - Section 9 (IO recording default off) → Task 3 (route construction sets `recordIO: false`)
  - Section 10 (testing) → Tasks 1, 2, 6, 7

- **Placeholder scan:** No "TBD" / "implement appropriate" / "similar to Task N" placeholders. The `(ctx as { ownerId?: string }).ownerId` cast in Task 4 Step 4.1 is explicitly replaced with a proper interface change in the same step.

- **Type consistency:** `SpanEmitter` methods (`startRun`, `startManifest`, `startStep`, `startInvoke`) and returned handle shapes (`RunSpan`, `ManifestSpan`, `StepSpan`, `InvokeSpan`, `ModelCallSpan`, `ToolCallSpan`) are consistent across Tasks 2, 3, 4, 5, 6, 7. `TraceSink` callback signature matches `TraceLiveEvent` discriminated union.

- **Compatibility:** `Telemetry` class is preserved as `class Telemetry extends SpanEmitter {}` (Task 2 Step 2.2) so the runner's existing `this.telemetry` field still works without modification — only the *new* span kinds (`run`, `manifest`, `step`) require any caller migration. Direct SDK consumers continue to operate.

- **Naming:** All span method names follow the `start<Kind>` convention. All span handle interfaces follow `<Kind>Span`. `TraceSink` mirrors `TraceLiveEvent`'s discriminator shape.

- **Risks called out in spec section 12:**
  - TraceRegistry as shared state — mitigated by mirroring the recently shipped RunRegistry pattern (Task 1).
  - Write amplification from naive per-span inserts — mitigated by batched flush (Task 1).
  - Crash safety — best-effort flush on shutdown is *not* in this slice and is acknowledged as a known limitation (matches existing `sessionStore.append`-at-end behavior).

- **Known limitation — parallel pipelines and stack-based parentage:** the `SpanEmitter` uses a single per-instance stack to determine parent IDs. This is correct for sequential execution but can produce wrong parent linkage when `executeParallel` runs branches concurrently — invoke/model/tool spans opened inside branch B while branch A is still building its tree may be attributed to A's most-recent step span. Spans themselves are all recorded; only the `parentId` may be wrong for inner spans in concurrent branches. **Fix in Slice 2.1** by switching the stack to `AsyncLocalStorage` (Node's `async_hooks`), which preserves per-branch context across `Promise.all`. For Slice 2 v1, sequential pipelines (the common case) work correctly. The integration test in Task 7 uses a sequential manifest specifically to avoid this issue.
