# Tracing v1 — Slice 1: TraceStore Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-11-tracing-v1-design.md` (Sections 5, 9, 13)

**Goal:** Add a pluggable `TraceStore` interface and four backend implementations (memory, JSON file, SQLite, Postgres) so the next slice (span emission) has a place to write spans. No emission, no API, no UI in this slice — purely the persistence layer.

**Architecture:** A new `TraceStore` interface in `@agntz/core/types`, implemented by every existing store backend (matching the `RunStore` pattern shipped in PR #19). Span persistence is row-per-span (`ar_spans`) plus a precomputed `ar_trace_summaries` roll-up table to power list views without span scans. Owner scoping on every row.

**Tech Stack:** TypeScript, vitest, tsup, biome, pg (Postgres driver), better-sqlite3, pnpm workspaces with turbo.

---

## Branch + working state

- [ ] **Step 0.1: Confirm you're on `main` and up to date**

```bash
git checkout main
git pull --ff-only
```

Expected: working tree clean, branch up to date with origin/main.

- [ ] **Step 0.2: Verify PR #19 (`/runs/*`) has merged**

```bash
git log --oneline -10 | grep -i "runs"
```

Expected: see `worker+sdk: /runs/* HTTP surface` in the recent commits (commit `f76bc6a` or later). This slice depends on the `Run` and `RunStore` types being on `main`.

- [ ] **Step 0.3: Create the slice branch**

```bash
git checkout -b slice-4-trace-store
```

(Numbering: the runs work was slices 1–3 of the broader multi-agent feature; this is slice 4 in that sequence, and also Slice 1 of the tracing feature. Either branch name works; this plan uses `slice-4-trace-store`.)

- [ ] **Step 0.4: Verify baseline tests pass**

```bash
pnpm install
pnpm test
```

Expected: all existing tests pass. If anything fails on `main`, stop and report — the slice cannot start on a broken baseline.

---

## File map

What this slice creates or modifies:

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/types.ts` | Modify | Add `Span`, `TraceSummary`, `TraceFilter`, `TraceLiveEvent`, `TraceStore`; extend `UnifiedStore` union |
| `packages/core/src/__tests__/trace-store-conformance.ts` | Create | Shared test suite — any backend implementing `TraceStore` passes this |
| `packages/core/src/__tests__/fixtures/traces.ts` | Create | Span fixtures used by conformance suite and later slices |
| `packages/core/src/stores/memory.ts` | Modify | Add `TraceStore` impl on `MemoryStore` (in-memory Maps) |
| `packages/core/src/__tests__/trace-store-memory.test.ts` | Create | Instantiate memory store, run conformance suite |
| `packages/core/src/stores/json-file.ts` | Modify | Add `TraceStore` impl on `JsonFileStore` |
| `packages/core/src/__tests__/trace-store-json.test.ts` | Create | Instantiate JSON store with tmpdir, run conformance suite |
| `packages/store-sqlite/src/sqlite-store.ts` | Modify | Add `TraceStore` impl + sqlite DDL |
| `packages/store-sqlite/tests/trace-store.test.ts` | Create | Instantiate sqlite store with `:memory:` DB, run conformance suite |
| `packages/store-postgres/src/postgres-store.ts` | Modify | Add `TraceStore` impl + v7 migration |
| `packages/store-postgres/tests/trace-store.test.ts` | Create | Instantiate Postgres store with unique `tablePrefix`, run conformance suite (`skipIf` when `DATABASE_URL` unset) |
| `packages/core/src/index.ts` | Modify | Export new types |

All four backends pass the same conformance suite — that's the design constraint that prevents drift between backends.

---

## Task 1: Define `TraceStore` types in `@agntz/core`

Adds the types but no implementation. Subsequent tasks make stores satisfy the interface.

**Files:**
- Modify: `packages/core/src/types.ts` (after the existing `RunStore` interface, ~line 619)

- [ ] **Step 1.1: Write a failing typecheck**

Open `packages/core/src/types.ts` and add a one-line stub at the bottom of the file:

```ts
// TODO(slice-4): TraceStore types go here
export type __TraceStoreStubAssertion = TraceStore;
```

Then run:

```bash
cd packages/core
pnpm typecheck
```

Expected: FAIL with `error TS2304: Cannot find name 'TraceStore'.`

This confirms our change will be observable.

- [ ] **Step 1.2: Add the type definitions**

Replace the stub line with the full set of types. Insert this block in `packages/core/src/types.ts` immediately after the `RunStore` interface (look for the comment marking the end of the "Runs" section). The new section follows the same `═══` separator style used throughout the file:

```ts
// ═══════════════════════════════════════════════════════════════════════
// Traces — persistent span trees for observability
// ═══════════════════════════════════════════════════════════════════════

export type SpanKind = "run" | "manifest" | "step" | "invoke" | "model" | "tool";
export type SpanStatus = "running" | "ok" | "error" | "cancelled";

/**
 * One span in a trace tree. Spans form a tree via `parentId` and share a
 * `traceId`. A trace is the set of all spans with the same `traceId`.
 */
export interface Span {
  spanId: string;
  traceId: string;
  parentId: string | null;
  ownerId: string;
  runId: string | null;
  sessionId: string | null;
  name: string;
  kind: SpanKind;
  startedAt: string; // ISO 8601
  endedAt: string | null;
  durationMs: number | null;
  status: SpanStatus;
  error: string | null;
  attributes: Record<string, unknown>;
  events: Array<{ ts: string; name: string; data?: unknown }>;
  scores: Record<string, { value: number; reason?: string }>;
  costUsd: number | null;
}

/**
 * Precomputed roll-up of one trace. Powers list views without scanning all
 * spans. Written/updated by the registry on trace start, span end, and
 * trace end.
 */
export interface TraceSummary {
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

export interface TraceFilter {
  ownerId: string;
  agentId?: string;
  status?: SpanStatus;
  startedAfter?: string;
  startedBefore?: string;
  limit?: number;  // default 50, max 200
  cursor?: string; // opaque; encodes (startedAt, traceId)
}

/**
 * Live event published to subscribers of an in-progress trace. The registry
 * emits these in real time; the worker forwards them over SSE.
 */
export type TraceLiveEvent =
  | { type: "span-start"; span: Span }
  | { type: "span-end"; spanId: string; patch: Partial<Span> }
  | { type: "trace-done"; summary: TraceSummary };

/**
 * Persistent record of spans and trace summaries. Implementations are
 * owner-scoped — every read filters on `ownerId`, every write tags it.
 */
export interface TraceStore {
  insertSpan(span: Span): Promise<void>;
  insertSpansBatch(spans: Span[]): Promise<void>;
  updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void>;
  upsertSummary(summary: TraceSummary): Promise<void>;
  getTrace(traceId: string, ownerId: string): Promise<Span[]>;
  getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null>;
  listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }>;
  deleteTrace(traceId: string, ownerId: string): Promise<void>;
  deleteOlderThan(ownerId: string, before: Date): Promise<number>;
}
```

- [ ] **Step 1.3: Extend the `UnifiedStore` union**

Find the `UnifiedStore` type (around line 660 in `types.ts`, just after `ScopableStore`). Add `TraceStore` to the union:

```ts
export type UnifiedStore = AgentStore &
  SessionStore &
  ContextStore &
  LogStore &
  ProviderStore &
  ConnectionStore &
  ApiKeyStore &
  RunStore &
  TraceStore &  // ← add this line
  ScopableStore;
```

- [ ] **Step 1.4: Verify typecheck fails because backends don't implement the new methods**

```bash
cd packages/core
pnpm typecheck
```

Expected: FAIL with errors like `Class 'MemoryStore' incorrectly implements interface 'UnifiedStore'. Property 'insertSpan' is missing`. That's the signal the contract is wired up. Tasks 2–6 satisfy this.

- [ ] **Step 1.5: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "$(cat <<'EOF'
core(types): add TraceStore interface for span persistence

Adds Span, TraceSummary, TraceFilter, TraceLiveEvent, and TraceStore to the
core types. Extends UnifiedStore so every backend must implement the new
methods. Backends are intentionally left broken; subsequent tasks satisfy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared conformance suite + fixtures

This is the single source of truth for "what TraceStore must do." Every backend's test file calls `runTraceStoreConformance(makeStore)`. Subsequent tasks (3–6) wire each backend into the suite.

**Files:**
- Create: `packages/core/src/__tests__/fixtures/traces.ts`
- Create: `packages/core/src/__tests__/trace-store-conformance.ts`

- [ ] **Step 2.1: Write the span fixture builder**

Create `packages/core/src/__tests__/fixtures/traces.ts`:

```ts
import type { Span, SpanKind, SpanStatus, TraceSummary } from "../../types.js";

/**
 * Build a Span with sensible defaults. Override anything that matters to the
 * test. Used by the conformance suite and by later slices' tests.
 */
export function makeSpan(overrides: Partial<Span> = {}): Span {
  const spanId = overrides.spanId ?? `sp_${Math.random().toString(36).slice(2, 10)}`;
  return {
    spanId,
    traceId: overrides.traceId ?? `tr_${Math.random().toString(36).slice(2, 10)}`,
    parentId: overrides.parentId ?? null,
    ownerId: overrides.ownerId ?? "user_test",
    runId: overrides.runId ?? null,
    sessionId: overrides.sessionId ?? null,
    name: overrides.name ?? "agent.invoke",
    kind: overrides.kind ?? "invoke",
    startedAt: overrides.startedAt ?? "2026-05-11T08:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    durationMs: overrides.durationMs ?? null,
    status: overrides.status ?? "running",
    error: overrides.error ?? null,
    attributes: overrides.attributes ?? {},
    events: overrides.events ?? [],
    scores: overrides.scores ?? {},
    costUsd: overrides.costUsd ?? null,
  };
}

export function makeSummary(overrides: Partial<TraceSummary> = {}): TraceSummary {
  return {
    traceId: overrides.traceId ?? `tr_${Math.random().toString(36).slice(2, 10)}`,
    ownerId: overrides.ownerId ?? "user_test",
    rootName: overrides.rootName ?? "agent.invoke",
    agentId: overrides.agentId ?? null,
    startedAt: overrides.startedAt ?? "2026-05-11T08:00:00.000Z",
    endedAt: overrides.endedAt ?? null,
    durationMs: overrides.durationMs ?? null,
    spanCount: overrides.spanCount ?? 1,
    status: overrides.status ?? "running",
    totalTokens: overrides.totalTokens ?? 0,
    totalCostUsd: overrides.totalCostUsd ?? null,
  };
}

/**
 * A complete, three-span trace fixture: run → invoke → model.call. Used by
 * tests that need a realistic shape, not just a single span.
 */
export function makeThreeSpanTrace(opts: {
  traceId: string;
  ownerId: string;
  agentId?: string;
}): Span[] {
  const { traceId, ownerId, agentId = "agent-x" } = opts;
  return [
    makeSpan({
      spanId: `${traceId}_root`,
      traceId,
      ownerId,
      parentId: null,
      name: "agent.run",
      kind: "run",
      status: "ok",
      startedAt: "2026-05-11T08:00:00.000Z",
      endedAt: "2026-05-11T08:00:02.000Z",
      durationMs: 2000,
      attributes: { "agent.id": agentId },
    }),
    makeSpan({
      spanId: `${traceId}_invoke`,
      traceId,
      ownerId,
      parentId: `${traceId}_root`,
      name: "agent.invoke",
      kind: "invoke",
      status: "ok",
      startedAt: "2026-05-11T08:00:00.100Z",
      endedAt: "2026-05-11T08:00:01.900Z",
      durationMs: 1800,
      attributes: { "agent.id": agentId, model: "claude-sonnet-4-6" },
    }),
    makeSpan({
      spanId: `${traceId}_model`,
      traceId,
      ownerId,
      parentId: `${traceId}_invoke`,
      name: "agent.model.call",
      kind: "model",
      status: "ok",
      startedAt: "2026-05-11T08:00:00.200Z",
      endedAt: "2026-05-11T08:00:01.500Z",
      durationMs: 1300,
      attributes: { "agent.step": 1, model: "claude-sonnet-4-6" },
      costUsd: 0.0042,
    }),
  ];
}
```

- [ ] **Step 2.2: Write the conformance suite**

Create `packages/core/src/__tests__/trace-store-conformance.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { TraceStore } from "../types.js";
import { makeSpan, makeSummary, makeThreeSpanTrace } from "./fixtures/traces.js";

/**
 * Shared TraceStore conformance suite. Every backend's test file calls this
 * with a factory that produces a fresh store for each test. The factory may
 * be async (e.g., to await migrations on Postgres).
 */
export function runTraceStoreConformance(
  suiteName: string,
  makeStore: () => Promise<TraceStore>
): void {
  describe(`${suiteName} — TraceStore conformance`, () => {
    let store: TraceStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    it("insertSpan + getTrace round-trips a single span", async () => {
      const span = makeSpan({ traceId: "tr_round_trip", ownerId: "u1" });
      await store.insertSpan(span);
      const got = await store.getTrace("tr_round_trip", "u1");
      expect(got).toHaveLength(1);
      expect(got[0].spanId).toBe(span.spanId);
      expect(got[0].traceId).toBe("tr_round_trip");
      expect(got[0].name).toBe("agent.invoke");
    });

    it("insertSpansBatch persists multiple spans atomically", async () => {
      const trace = makeThreeSpanTrace({ traceId: "tr_batch", ownerId: "u1" });
      await store.insertSpansBatch(trace);
      const got = await store.getTrace("tr_batch", "u1");
      expect(got).toHaveLength(3);
      const kinds = got.map((s) => s.kind).sort();
      expect(kinds).toEqual(["invoke", "model", "run"]);
    });

    it("getTrace returns spans owner-scoped", async () => {
      await store.insertSpan(makeSpan({ traceId: "tr_shared", ownerId: "u1" }));
      await store.insertSpan(makeSpan({ traceId: "tr_shared", ownerId: "u2" }));
      const u1 = await store.getTrace("tr_shared", "u1");
      const u2 = await store.getTrace("tr_shared", "u2");
      expect(u1).toHaveLength(1);
      expect(u2).toHaveLength(1);
      expect(u1[0].ownerId).toBe("u1");
      expect(u2[0].ownerId).toBe("u2");
    });

    it("getTrace returns empty array for unknown trace", async () => {
      const got = await store.getTrace("tr_nope", "u1");
      expect(got).toEqual([]);
    });

    it("updateSpan patches endedAt, status, error", async () => {
      const span = makeSpan({ spanId: "sp_update", traceId: "tr_u", ownerId: "u1" });
      await store.insertSpan(span);
      await store.updateSpan("sp_update", "u1", {
        endedAt: "2026-05-11T08:00:03.000Z",
        durationMs: 3000,
        status: "ok",
      });
      const got = await store.getTrace("tr_u", "u1");
      expect(got[0].endedAt).toBe("2026-05-11T08:00:03.000Z");
      expect(got[0].durationMs).toBe(3000);
      expect(got[0].status).toBe("ok");
    });

    it("updateSpan is owner-scoped (cannot patch another tenant's span)", async () => {
      const span = makeSpan({ spanId: "sp_owned", traceId: "tr_o", ownerId: "u1" });
      await store.insertSpan(span);
      await store.updateSpan("sp_owned", "u2", { status: "error" }); // wrong owner
      const got = await store.getTrace("tr_o", "u1");
      expect(got[0].status).toBe("running"); // unchanged
    });

    it("upsertSummary + getSummary round-trips", async () => {
      const summary = makeSummary({
        traceId: "tr_sum",
        ownerId: "u1",
        agentId: "agent-x",
        spanCount: 3,
        status: "ok",
        durationMs: 1500,
        totalTokens: 412,
      });
      await store.upsertSummary(summary);
      const got = await store.getSummary("tr_sum", "u1");
      expect(got).not.toBeNull();
      expect(got!.agentId).toBe("agent-x");
      expect(got!.spanCount).toBe(3);
      expect(got!.totalTokens).toBe(412);
    });

    it("upsertSummary updates an existing summary", async () => {
      const summary = makeSummary({ traceId: "tr_up", ownerId: "u1", status: "running", spanCount: 1 });
      await store.upsertSummary(summary);
      await store.upsertSummary({ ...summary, status: "ok", spanCount: 5, endedAt: "2026-05-11T08:01:00.000Z" });
      const got = await store.getSummary("tr_up", "u1");
      expect(got!.status).toBe("ok");
      expect(got!.spanCount).toBe(5);
      expect(got!.endedAt).toBe("2026-05-11T08:01:00.000Z");
    });

    it("getSummary returns null for unknown trace", async () => {
      const got = await store.getSummary("tr_nope", "u1");
      expect(got).toBeNull();
    });

    it("listTraces returns owner-scoped rows newest-first", async () => {
      await store.upsertSummary(makeSummary({ traceId: "tr_a", ownerId: "u1", startedAt: "2026-05-11T08:00:00.000Z" }));
      await store.upsertSummary(makeSummary({ traceId: "tr_b", ownerId: "u1", startedAt: "2026-05-11T08:00:30.000Z" }));
      await store.upsertSummary(makeSummary({ traceId: "tr_c", ownerId: "u2", startedAt: "2026-05-11T08:00:15.000Z" }));

      const u1 = await store.listTraces({ ownerId: "u1" });
      expect(u1.rows.map((r) => r.traceId)).toEqual(["tr_b", "tr_a"]);

      const u2 = await store.listTraces({ ownerId: "u2" });
      expect(u2.rows.map((r) => r.traceId)).toEqual(["tr_c"]);
    });

    it("listTraces filters by agentId", async () => {
      await store.upsertSummary(makeSummary({ traceId: "tr_a", ownerId: "u1", agentId: "alpha" }));
      await store.upsertSummary(makeSummary({ traceId: "tr_b", ownerId: "u1", agentId: "beta" }));
      const filtered = await store.listTraces({ ownerId: "u1", agentId: "alpha" });
      expect(filtered.rows).toHaveLength(1);
      expect(filtered.rows[0].traceId).toBe("tr_a");
    });

    it("listTraces filters by status", async () => {
      await store.upsertSummary(makeSummary({ traceId: "tr_ok", ownerId: "u1", status: "ok" }));
      await store.upsertSummary(makeSummary({ traceId: "tr_err", ownerId: "u1", status: "error" }));
      const errors = await store.listTraces({ ownerId: "u1", status: "error" });
      expect(errors.rows).toHaveLength(1);
      expect(errors.rows[0].traceId).toBe("tr_err");
    });

    it("listTraces filters by startedAfter / startedBefore", async () => {
      await store.upsertSummary(makeSummary({ traceId: "tr_old", ownerId: "u1", startedAt: "2026-05-10T00:00:00.000Z" }));
      await store.upsertSummary(makeSummary({ traceId: "tr_new", ownerId: "u1", startedAt: "2026-05-11T00:00:00.000Z" }));
      const recent = await store.listTraces({ ownerId: "u1", startedAfter: "2026-05-10T12:00:00.000Z" });
      expect(recent.rows.map((r) => r.traceId)).toEqual(["tr_new"]);
      const old = await store.listTraces({ ownerId: "u1", startedBefore: "2026-05-10T12:00:00.000Z" });
      expect(old.rows.map((r) => r.traceId)).toEqual(["tr_old"]);
    });

    it("listTraces paginates via cursor", async () => {
      for (let i = 0; i < 5; i++) {
        await store.upsertSummary(
          makeSummary({
            traceId: `tr_p${i}`,
            ownerId: "u1",
            startedAt: `2026-05-11T08:0${i}:00.000Z`,
          })
        );
      }
      const page1 = await store.listTraces({ ownerId: "u1", limit: 2 });
      expect(page1.rows).toHaveLength(2);
      expect(page1.cursor).toBeDefined();

      const page2 = await store.listTraces({ ownerId: "u1", limit: 2, cursor: page1.cursor });
      expect(page2.rows).toHaveLength(2);
      // No overlap between pages.
      const ids1 = new Set(page1.rows.map((r) => r.traceId));
      for (const r of page2.rows) expect(ids1.has(r.traceId)).toBe(false);
    });

    it("deleteTrace removes all spans and summary", async () => {
      const trace = makeThreeSpanTrace({ traceId: "tr_del", ownerId: "u1" });
      await store.insertSpansBatch(trace);
      await store.upsertSummary(makeSummary({ traceId: "tr_del", ownerId: "u1", spanCount: 3 }));

      await store.deleteTrace("tr_del", "u1");

      expect(await store.getTrace("tr_del", "u1")).toEqual([]);
      expect(await store.getSummary("tr_del", "u1")).toBeNull();
    });

    it("deleteTrace is owner-scoped", async () => {
      await store.insertSpan(makeSpan({ traceId: "tr_keep", ownerId: "u1" }));
      await store.deleteTrace("tr_keep", "u2"); // wrong owner
      expect(await store.getTrace("tr_keep", "u1")).toHaveLength(1);
    });

    it("deleteOlderThan deletes traces whose startedAt < cutoff, returns count", async () => {
      await store.upsertSummary(makeSummary({ traceId: "tr_old1", ownerId: "u1", startedAt: "2026-05-09T00:00:00.000Z" }));
      await store.insertSpan(makeSpan({ traceId: "tr_old1", ownerId: "u1", startedAt: "2026-05-09T00:00:00.000Z" }));
      await store.upsertSummary(makeSummary({ traceId: "tr_new1", ownerId: "u1", startedAt: "2026-05-11T00:00:00.000Z" }));
      await store.insertSpan(makeSpan({ traceId: "tr_new1", ownerId: "u1", startedAt: "2026-05-11T00:00:00.000Z" }));

      const cutoff = new Date("2026-05-10T00:00:00.000Z");
      const deleted = await store.deleteOlderThan("u1", cutoff);
      expect(deleted).toBe(1);

      expect(await store.getTrace("tr_old1", "u1")).toEqual([]);
      expect(await store.getTrace("tr_new1", "u1")).toHaveLength(1);
    });

    it("deleteOlderThan is owner-scoped", async () => {
      await store.upsertSummary(makeSummary({ traceId: "tr_u2_old", ownerId: "u2", startedAt: "2026-05-01T00:00:00.000Z" }));
      const deleted = await store.deleteOlderThan("u1", new Date("2026-05-10T00:00:00.000Z"));
      expect(deleted).toBe(0);
      expect(await store.getSummary("tr_u2_old", "u2")).not.toBeNull();
    });
  });
}
```

- [ ] **Step 2.3: Verify the conformance file typechecks (no runtime exec yet)**

```bash
cd packages/core
pnpm typecheck
```

Expected: the `MemoryStore implements TraceStore` errors from Task 1 still remain (those resolve in Task 3). The new files themselves should typecheck fine — verify no errors mention `trace-store-conformance.ts` or `fixtures/traces.ts`.

- [ ] **Step 2.4: Commit**

```bash
git add packages/core/src/__tests__/fixtures/traces.ts packages/core/src/__tests__/trace-store-conformance.ts
git commit -m "$(cat <<'EOF'
core(tests): add TraceStore conformance suite + span fixtures

Single source of truth for what TraceStore must do. Every backend's test file
will call runTraceStoreConformance(makeStore). Eighteen test cases cover
insert/batch-insert/update/get/list (with filters + pagination)/delete/retention,
all owner-scoped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `MemoryStore` TraceStore implementation

**Files:**
- Modify: `packages/core/src/stores/memory.ts` (after the `RunStore` section, ~line 460)
- Create: `packages/core/src/__tests__/trace-store-memory.test.ts`

- [ ] **Step 3.1: Write the wiring test (will fail because methods don't exist)**

Create `packages/core/src/__tests__/trace-store-memory.test.ts`:

```ts
import { MemoryStore } from "../stores/memory.js";
import { runTraceStoreConformance } from "./trace-store-conformance.js";

runTraceStoreConformance("MemoryStore", async () => {
  // Admin store + scoped facet to keep parity with how other tests construct.
  const admin = new MemoryStore();
  // MemoryStore is not owner-scoped at construction; methods take ownerId.
  // Cast to TraceStore — the conformance suite only uses TraceStore methods.
  return admin as unknown as import("../types.js").TraceStore;
});
```

Run:

```bash
cd packages/core
pnpm test trace-store-memory
```

Expected: FAIL — `MemoryStore` doesn't have `insertSpan` yet (TypeScript will catch it at the test level too).

- [ ] **Step 3.2: Add the in-memory storage to the `MemoryBackend`**

In `packages/core/src/stores/memory.ts`, find the `MemoryBackend` class/interface (the object holding `runs`, `agents`, etc., that's shared between admin and scoped instances). Add two new fields to that backend:

```ts
// In MemoryBackend (the shared state object — search for the existing
// `runs: Map<string, Map<string, Run>>` line and add these next to it):
spans: Map<string, Span>;           // keyed by spanId; ownerId checked at read
summaries: Map<string, TraceSummary>; // keyed by traceId; ownerId checked at read
```

Also import `Span` and `TraceSummary` at the top of `memory.ts` if not already imported:

```ts
import type {
  // …existing imports
  Span,
  TraceSummary,
  TraceFilter,
} from "../types.js";
```

In the backend factory / constructor (search for `new Map()` calls initializing the existing fields), initialize the new ones:

```ts
this.spans = new Map();
this.summaries = new Map();
```

- [ ] **Step 3.3: Implement the eight TraceStore methods on `MemoryStore`**

After the `═══ RunStore ═══` section in `packages/core/src/stores/memory.ts` (around line 460), add:

```ts
  // ═══ TraceStore ═══

  async insertSpan(span: Span): Promise<void> {
    this.backend.spans.set(span.spanId, { ...span });
  }

  async insertSpansBatch(spans: Span[]): Promise<void> {
    for (const s of spans) this.backend.spans.set(s.spanId, { ...s });
  }

  async updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void> {
    const existing = this.backend.spans.get(spanId);
    if (!existing || existing.ownerId !== ownerId) return; // owner-scoped silent no-op
    this.backend.spans.set(spanId, { ...existing, ...patch, spanId, ownerId });
  }

  async upsertSummary(summary: TraceSummary): Promise<void> {
    this.backend.summaries.set(summary.traceId, { ...summary });
  }

  async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
    const out: Span[] = [];
    for (const s of this.backend.spans.values()) {
      if (s.traceId === traceId && s.ownerId === ownerId) out.push({ ...s });
    }
    // Order by startedAt then spanId so callers get deterministic tree assembly.
    return out.sort(
      (a, b) => a.startedAt.localeCompare(b.startedAt) || a.spanId.localeCompare(b.spanId)
    );
  }

  async getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null> {
    const s = this.backend.summaries.get(traceId);
    if (!s || s.ownerId !== ownerId) return null;
    return { ...s };
  }

  async listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const all: TraceSummary[] = [];
    for (const s of this.backend.summaries.values()) {
      if (s.ownerId !== filter.ownerId) continue;
      if (filter.agentId && s.agentId !== filter.agentId) continue;
      if (filter.status && s.status !== filter.status) continue;
      if (filter.startedAfter && s.startedAt < filter.startedAfter) continue;
      if (filter.startedBefore && s.startedAt > filter.startedBefore) continue;
      all.push({ ...s });
    }
    all.sort(
      (a, b) =>
        b.startedAt.localeCompare(a.startedAt) || b.traceId.localeCompare(a.traceId)
    );

    let startIdx = 0;
    if (filter.cursor) {
      const decoded = decodeCursor(filter.cursor);
      if (decoded) {
        startIdx = all.findIndex(
          (r) =>
            r.startedAt < decoded.startedAt ||
            (r.startedAt === decoded.startedAt && r.traceId < decoded.traceId)
        );
        if (startIdx === -1) startIdx = all.length;
      }
    }

    const rows = all.slice(startIdx, startIdx + limit);
    const cursor =
      rows.length === limit
        ? encodeCursor({ startedAt: rows[rows.length - 1].startedAt, traceId: rows[rows.length - 1].traceId })
        : undefined;
    return { rows, cursor };
  }

  async deleteTrace(traceId: string, ownerId: string): Promise<void> {
    const summary = this.backend.summaries.get(traceId);
    if (summary && summary.ownerId !== ownerId) return;
    this.backend.summaries.delete(traceId);
    for (const [spanId, span] of this.backend.spans) {
      if (span.traceId === traceId && span.ownerId === ownerId) {
        this.backend.spans.delete(spanId);
      }
    }
  }

  async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
    const beforeIso = before.toISOString();
    const traceIdsToDelete: string[] = [];
    for (const s of this.backend.summaries.values()) {
      if (s.ownerId === ownerId && s.startedAt < beforeIso) traceIdsToDelete.push(s.traceId);
    }
    for (const tid of traceIdsToDelete) {
      this.backend.summaries.delete(tid);
      for (const [spanId, span] of this.backend.spans) {
        if (span.traceId === tid && span.ownerId === ownerId) {
          this.backend.spans.delete(spanId);
        }
      }
    }
    return traceIdsToDelete.length;
  }
```

Also add the cursor helpers at the bottom of `memory.ts` (before the closing of the file, outside the class):

```ts
function encodeCursor(c: { startedAt: string; traceId: string }): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(s: string): { startedAt: string; traceId: string } | null {
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
```

- [ ] **Step 3.4: Run the conformance suite — expect PASS**

```bash
cd packages/core
pnpm test trace-store-memory
```

Expected: all 18 conformance tests PASS.

- [ ] **Step 3.5: Run full core test suite to confirm no regressions**

```bash
cd packages/core
pnpm test
```

Expected: existing tests pass, new conformance tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add packages/core/src/stores/memory.ts packages/core/src/__tests__/trace-store-memory.test.ts
git commit -m "$(cat <<'EOF'
core(memory): implement TraceStore on MemoryStore

In-memory Maps for spans and summaries, owner-scoped on every read/write.
Passes the full TraceStore conformance suite. Includes cursor pagination
helpers (encodeCursor/decodeCursor) reused by other backends.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `JsonFileStore` TraceStore implementation

**Files:**
- Modify: `packages/core/src/stores/json-file.ts`
- Create: `packages/core/src/__tests__/trace-store-json.test.ts`

`JsonFileStore` keeps everything in memory and persists the full state to a JSON file. Trace data follows the same pattern.

- [ ] **Step 4.1: Write the wiring test**

Create `packages/core/src/__tests__/trace-store-json.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach } from "vitest";
import { JsonFileStore } from "../stores/json-file.js";
import { runTraceStoreConformance } from "./trace-store-conformance.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "agntz-trace-json-"));
});

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

runTraceStoreConformance("JsonFileStore", async () => {
  const store = new JsonFileStore({ filePath: join(tmpDir, "store.json") });
  return store as unknown as import("../types.js").TraceStore;
});
```

Run:

```bash
cd packages/core
pnpm test trace-store-json
```

Expected: FAIL — `JsonFileStore` doesn't implement TraceStore yet.

- [ ] **Step 4.2: Add spans/summaries to the persisted JSON shape**

Open `packages/core/src/stores/json-file.ts`. Locate the type or interface defining the persisted file structure (search for `runs` as a field in an interface that looks like `JsonFileShape` or similar — the runs work added it). Add two fields next to `runs`:

```ts
// In whichever interface defines the JSON file's on-disk shape:
spans?: Record<string, Span>;       // keyed by spanId
summaries?: Record<string, TraceSummary>; // keyed by traceId
```

Add imports at the top if not present:

```ts
import type {
  // …existing
  Span,
  TraceSummary,
  TraceFilter,
} from "../types.js";
```

In the load/serialize functions (the methods that read the file in and write it out — typically named `load` and `save` / `flush`), initialize the new fields when absent and persist them when writing. They use the same default-empty-object treatment as `runs`.

- [ ] **Step 4.3: Implement the eight TraceStore methods on `JsonFileStore`**

After the `═══ RunStore ═══` section in `json-file.ts` (around line 466), add (note: `JsonFileStore` operates on the loaded in-memory state then calls `this.save()` to persist — match the pattern of nearby methods like `putRun`):

```ts
  // ═══ TraceStore ═══

  async insertSpan(span: Span): Promise<void> {
    await this.load();
    this.data.spans ??= {};
    this.data.spans[span.spanId] = { ...span };
    await this.save();
  }

  async insertSpansBatch(spans: Span[]): Promise<void> {
    await this.load();
    this.data.spans ??= {};
    for (const s of spans) this.data.spans[s.spanId] = { ...s };
    await this.save();
  }

  async updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void> {
    await this.load();
    const existing = this.data.spans?.[spanId];
    if (!existing || existing.ownerId !== ownerId) return;
    this.data.spans![spanId] = { ...existing, ...patch, spanId, ownerId };
    await this.save();
  }

  async upsertSummary(summary: TraceSummary): Promise<void> {
    await this.load();
    this.data.summaries ??= {};
    this.data.summaries[summary.traceId] = { ...summary };
    await this.save();
  }

  async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
    await this.load();
    const out: Span[] = [];
    for (const s of Object.values(this.data.spans ?? {})) {
      if (s.traceId === traceId && s.ownerId === ownerId) out.push({ ...s });
    }
    return out.sort(
      (a, b) => a.startedAt.localeCompare(b.startedAt) || a.spanId.localeCompare(b.spanId)
    );
  }

  async getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null> {
    await this.load();
    const s = this.data.summaries?.[traceId];
    if (!s || s.ownerId !== ownerId) return null;
    return { ...s };
  }

  async listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }> {
    await this.load();
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const all: TraceSummary[] = [];
    for (const s of Object.values(this.data.summaries ?? {})) {
      if (s.ownerId !== filter.ownerId) continue;
      if (filter.agentId && s.agentId !== filter.agentId) continue;
      if (filter.status && s.status !== filter.status) continue;
      if (filter.startedAfter && s.startedAt < filter.startedAfter) continue;
      if (filter.startedBefore && s.startedAt > filter.startedBefore) continue;
      all.push({ ...s });
    }
    all.sort(
      (a, b) =>
        b.startedAt.localeCompare(a.startedAt) || b.traceId.localeCompare(a.traceId)
    );

    let startIdx = 0;
    if (filter.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8")) as {
          startedAt: string;
          traceId: string;
        };
        startIdx = all.findIndex(
          (r) =>
            r.startedAt < decoded.startedAt ||
            (r.startedAt === decoded.startedAt && r.traceId < decoded.traceId)
        );
        if (startIdx === -1) startIdx = all.length;
      } catch {
        // bad cursor — start from beginning
      }
    }

    const rows = all.slice(startIdx, startIdx + limit);
    const cursor =
      rows.length === limit
        ? Buffer.from(
            JSON.stringify({
              startedAt: rows[rows.length - 1].startedAt,
              traceId: rows[rows.length - 1].traceId,
            })
          ).toString("base64url")
        : undefined;
    return { rows, cursor };
  }

  async deleteTrace(traceId: string, ownerId: string): Promise<void> {
    await this.load();
    const summary = this.data.summaries?.[traceId];
    if (summary && summary.ownerId !== ownerId) return;
    if (this.data.summaries) delete this.data.summaries[traceId];
    if (this.data.spans) {
      for (const spanId of Object.keys(this.data.spans)) {
        const span = this.data.spans[spanId];
        if (span.traceId === traceId && span.ownerId === ownerId) {
          delete this.data.spans[spanId];
        }
      }
    }
    await this.save();
  }

  async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
    await this.load();
    const beforeIso = before.toISOString();
    const toDelete: string[] = [];
    for (const s of Object.values(this.data.summaries ?? {})) {
      if (s.ownerId === ownerId && s.startedAt < beforeIso) toDelete.push(s.traceId);
    }
    for (const tid of toDelete) {
      delete this.data.summaries![tid];
      if (this.data.spans) {
        for (const spanId of Object.keys(this.data.spans)) {
          const span = this.data.spans[spanId];
          if (span.traceId === tid && span.ownerId === ownerId) {
            delete this.data.spans[spanId];
          }
        }
      }
    }
    await this.save();
    return toDelete.length;
  }
```

- [ ] **Step 4.4: Run the conformance suite — expect PASS**

```bash
cd packages/core
pnpm test trace-store-json
```

Expected: all 18 conformance tests PASS.

- [ ] **Step 4.5: Run full core test suite**

```bash
cd packages/core
pnpm test
```

Expected: all tests pass (memory + json + everything else).

- [ ] **Step 4.6: Commit**

```bash
git add packages/core/src/stores/json-file.ts packages/core/src/__tests__/trace-store-json.test.ts
git commit -m "$(cat <<'EOF'
core(json-file): implement TraceStore on JsonFileStore

Spans and summaries persist alongside the existing run/agent/session data
in the same JSON file. Same conformance suite as MemoryStore — 18 tests pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `SqliteStore` TraceStore implementation

**Files:**
- Modify: `packages/store-sqlite/src/sqlite-store.ts`
- Create: `packages/store-sqlite/tests/trace-store.test.ts`

- [ ] **Step 5.1: Write the wiring test**

Create `packages/store-sqlite/tests/trace-store.test.ts`:

```ts
import { SqliteStore } from "../src/sqlite-store.js";
import { runTraceStoreConformance } from "@agntz/core/src/__tests__/trace-store-conformance.js";

runTraceStoreConformance("SqliteStore", async () => {
  // In-memory SQLite DB so tests don't touch disk.
  const store = new SqliteStore({ path: ":memory:" });
  return store as unknown as import("@agntz/core").TraceStore;
});
```

Note: if `@agntz/core/src/...` direct imports don't work due to the package's `exports` map, change to a relative path: `import { runTraceStoreConformance } from "../../core/src/__tests__/trace-store-conformance.js"`. Or add a test-only export to `packages/core/package.json` exports for the `__tests__` directory. Verify by running:

```bash
cd packages/store-sqlite
pnpm test trace-store
```

Expected: FAIL — either at import resolution (fix the path) or at runtime (SqliteStore doesn't implement TraceStore).

- [ ] **Step 5.2: Add the SQLite DDL for `ar_spans` and `ar_trace_summaries`**

In `packages/store-sqlite/src/sqlite-store.ts`, find the DDL section (the place where existing tables like `ar_runs` are created — search for `CREATE TABLE IF NOT EXISTS ar_runs`). Add the two new tables in the same place:

```sql
CREATE TABLE IF NOT EXISTS ar_spans (
  span_id      TEXT PRIMARY KEY,
  trace_id     TEXT NOT NULL,
  parent_id    TEXT,
  owner_id     TEXT NOT NULL,
  run_id       TEXT,
  session_id   TEXT,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('run','manifest','step','invoke','model','tool')),
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  duration_ms  INTEGER,
  status       TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
  error        TEXT,
  attributes   TEXT NOT NULL DEFAULT '{}',
  events       TEXT NOT NULL DEFAULT '[]',
  scores       TEXT NOT NULL DEFAULT '{}',
  cost_usd     REAL
);
CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_started ON ar_spans (owner_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_spans_trace ON ar_spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_ar_spans_parent ON ar_spans (parent_id);

CREATE TABLE IF NOT EXISTS ar_trace_summaries (
  trace_id        TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  root_name       TEXT NOT NULL,
  agent_id        TEXT,
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  duration_ms     INTEGER,
  span_count      INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  REAL
);
CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_started
  ON ar_trace_summaries (owner_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_agent
  ON ar_trace_summaries (owner_id, agent_id);
```

(Note: SQLite uses TEXT for timestamps; we store ISO 8601. JSONB doesn't exist in SQLite — we use TEXT and `JSON.stringify`/`JSON.parse`.)

- [ ] **Step 5.3: Implement the eight TraceStore methods on `SqliteStore`**

After the `═══ RunStore ═══` section in `packages/store-sqlite/src/sqlite-store.ts` (around line 763), add. Note that `this.db` is the `better-sqlite3` Database instance and statements are synchronous; the methods stay `async` for interface consistency:

```ts
  // ═══ TraceStore ═══

  async insertSpan(span: Span): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ar_spans (
          span_id, trace_id, parent_id, owner_id, run_id, session_id,
          name, kind, started_at, ended_at, duration_ms, status, error,
          attributes, events, scores, cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        span.spanId,
        span.traceId,
        span.parentId,
        span.ownerId,
        span.runId,
        span.sessionId,
        span.name,
        span.kind,
        span.startedAt,
        span.endedAt,
        span.durationMs,
        span.status,
        span.error,
        JSON.stringify(span.attributes),
        JSON.stringify(span.events),
        JSON.stringify(span.scores),
        span.costUsd
      );
  }

  async insertSpansBatch(spans: Span[]): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ar_spans (
        span_id, trace_id, parent_id, owner_id, run_id, session_id,
        name, kind, started_at, ended_at, duration_ms, status, error,
        attributes, events, scores, cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMany = this.db.transaction((rows: Span[]) => {
      for (const s of rows) {
        stmt.run(
          s.spanId, s.traceId, s.parentId, s.ownerId, s.runId, s.sessionId,
          s.name, s.kind, s.startedAt, s.endedAt, s.durationMs, s.status, s.error,
          JSON.stringify(s.attributes), JSON.stringify(s.events), JSON.stringify(s.scores),
          s.costUsd
        );
      }
    });
    insertMany(spans);
  }

  async updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void> {
    // Owner-scoped: only update if span exists and belongs to this owner.
    const existing = this.db
      .prepare(`SELECT * FROM ar_spans WHERE span_id = ? AND owner_id = ?`)
      .get(spanId, ownerId) as Record<string, unknown> | undefined;
    if (!existing) return;

    const merged: Span = { ...rowToSpan(existing), ...patch, spanId, ownerId };
    // Re-insert via the existing path; PK collision REPLACEs.
    await this.insertSpan(merged);
  }

  async upsertSummary(summary: TraceSummary): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ar_trace_summaries (
          trace_id, owner_id, root_name, agent_id, started_at, ended_at,
          duration_ms, span_count, status, total_tokens, total_cost_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        summary.traceId,
        summary.ownerId,
        summary.rootName,
        summary.agentId,
        summary.startedAt,
        summary.endedAt,
        summary.durationMs,
        summary.spanCount,
        summary.status,
        summary.totalTokens,
        summary.totalCostUsd
      );
  }

  async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM ar_spans
         WHERE trace_id = ? AND owner_id = ?
         ORDER BY started_at ASC, span_id ASC`
      )
      .all(traceId, ownerId) as Record<string, unknown>[];
    return rows.map(rowToSpan);
  }

  async getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM ar_trace_summaries
         WHERE trace_id = ? AND owner_id = ?`
      )
      .get(traceId, ownerId) as Record<string, unknown> | undefined;
    return row ? rowToSummary(row) : null;
  }

  async listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const clauses = [`owner_id = ?`];
    const args: unknown[] = [filter.ownerId];
    if (filter.agentId) {
      clauses.push(`agent_id = ?`);
      args.push(filter.agentId);
    }
    if (filter.status) {
      clauses.push(`status = ?`);
      args.push(filter.status);
    }
    if (filter.startedAfter) {
      clauses.push(`started_at >= ?`);
      args.push(filter.startedAfter);
    }
    if (filter.startedBefore) {
      clauses.push(`started_at <= ?`);
      args.push(filter.startedBefore);
    }
    if (filter.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8")) as {
          startedAt: string;
          traceId: string;
        };
        clauses.push(`(started_at < ? OR (started_at = ? AND trace_id < ?))`);
        args.push(decoded.startedAt, decoded.startedAt, decoded.traceId);
      } catch {
        // ignore bad cursor
      }
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM ar_trace_summaries
         WHERE ${clauses.join(" AND ")}
         ORDER BY started_at DESC, trace_id DESC
         LIMIT ?`
      )
      .all(...args, limit) as Record<string, unknown>[];

    const summaries = rows.map(rowToSummary);
    const cursor =
      summaries.length === limit
        ? Buffer.from(
            JSON.stringify({
              startedAt: summaries[summaries.length - 1].startedAt,
              traceId: summaries[summaries.length - 1].traceId,
            })
          ).toString("base64url")
        : undefined;
    return { rows: summaries, cursor };
  }

  async deleteTrace(traceId: string, ownerId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM ar_spans WHERE trace_id = ? AND owner_id = ?`)
        .run(traceId, ownerId);
      this.db
        .prepare(`DELETE FROM ar_trace_summaries WHERE trace_id = ? AND owner_id = ?`)
        .run(traceId, ownerId);
    });
    tx();
  }

  async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
    const beforeIso = before.toISOString();
    let deletedCount = 0;
    const tx = this.db.transaction(() => {
      const summaryRows = this.db
        .prepare(
          `SELECT trace_id FROM ar_trace_summaries
           WHERE owner_id = ? AND started_at < ?`
        )
        .all(ownerId, beforeIso) as { trace_id: string }[];
      deletedCount = summaryRows.length;
      for (const r of summaryRows) {
        this.db
          .prepare(`DELETE FROM ar_spans WHERE trace_id = ? AND owner_id = ?`)
          .run(r.trace_id, ownerId);
      }
      this.db
        .prepare(
          `DELETE FROM ar_trace_summaries
           WHERE owner_id = ? AND started_at < ?`
        )
        .run(ownerId, beforeIso);
    });
    tx();
    return deletedCount;
  }
```

Add the row-mapper helpers at the bottom of `sqlite-store.ts` (outside the class):

```ts
function rowToSpan(r: Record<string, unknown>): Span {
  return {
    spanId: r.span_id as string,
    traceId: r.trace_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    ownerId: r.owner_id as string,
    runId: (r.run_id as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    name: r.name as string,
    kind: r.kind as Span["kind"],
    startedAt: r.started_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null,
    status: r.status as Span["status"],
    error: (r.error as string | null) ?? null,
    attributes: JSON.parse((r.attributes as string) ?? "{}"),
    events: JSON.parse((r.events as string) ?? "[]"),
    scores: JSON.parse((r.scores as string) ?? "{}"),
    costUsd: (r.cost_usd as number | null) ?? null,
  };
}

function rowToSummary(r: Record<string, unknown>): TraceSummary {
  return {
    traceId: r.trace_id as string,
    ownerId: r.owner_id as string,
    rootName: r.root_name as string,
    agentId: (r.agent_id as string | null) ?? null,
    startedAt: r.started_at as string,
    endedAt: (r.ended_at as string | null) ?? null,
    durationMs: (r.duration_ms as number | null) ?? null,
    spanCount: r.span_count as number,
    status: r.status as TraceSummary["status"],
    totalTokens: r.total_tokens as number,
    totalCostUsd: (r.total_cost_usd as number | null) ?? null,
  };
}
```

Add imports at the top of the file:

```ts
import type {
  // …existing
  Span,
  TraceSummary,
  TraceFilter,
} from "@agntz/core";
```

- [ ] **Step 5.4: Run the conformance suite — expect PASS**

```bash
cd packages/store-sqlite
pnpm test trace-store
```

Expected: all 18 conformance tests PASS.

- [ ] **Step 5.5: Run full sqlite test suite**

```bash
cd packages/store-sqlite
pnpm test
```

Expected: existing tests pass, new conformance tests pass.

- [ ] **Step 5.6: Commit**

```bash
git add packages/store-sqlite/src/sqlite-store.ts packages/store-sqlite/tests/trace-store.test.ts
git commit -m "$(cat <<'EOF'
sqlite: implement TraceStore on SqliteStore

ar_spans + ar_trace_summaries tables with owner_id scoping. JSON columns are
TEXT (no JSONB in SQLite), serialized via JSON.stringify/JSON.parse. Batch
inserts use better-sqlite3 transactions. Passes the 18-test conformance suite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `PostgresStore` TraceStore implementation + v7 migration

**Files:**
- Modify: `packages/store-postgres/src/postgres-store.ts`
- Create: `packages/store-postgres/tests/trace-store.test.ts`

- [ ] **Step 6.1: Write the wiring test**

Create `packages/store-postgres/tests/trace-store.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresStore } from "../src/postgres-store.js";
import { runTraceStoreConformance } from "@agntz/core/src/__tests__/trace-store-conformance.js";

const url = process.env.DATABASE_URL;
const hasDb = !!url;

describe.skipIf(!hasDb)("PostgresStore trace tests", () => {
  let admin: PostgresStore;
  const prefix = `art_traces_${Date.now()}_`;

  beforeAll(async () => {
    admin = new PostgresStore({ connection: url!, tablePrefix: prefix });
  });

  afterAll(async () => {
    try {
      await admin.pgPool.query(`DROP TABLE IF EXISTS ${prefix}spans CASCADE`);
      await admin.pgPool.query(`DROP TABLE IF EXISTS ${prefix}trace_summaries CASCADE`);
    } catch {
      // ignore
    }
    await admin.close();
  });

  runTraceStoreConformance("PostgresStore (integration)", async () => {
    // Conformance suite expects a TraceStore that is NOT scoped at construction;
    // method calls pass ownerId. Postgres admin instance has user_id resolution
    // via method arguments here.
    return admin as unknown as import("@agntz/core").TraceStore;
  });
});
```

Note: if the path `@agntz/core/src/__tests__/...` is not exported, use a relative path: `import { runTraceStoreConformance } from "../../core/src/__tests__/trace-store-conformance.js"`.

Run (without DATABASE_URL, all tests `skipIf`):

```bash
cd packages/store-postgres
pnpm test trace-store
```

Expected: tests skipped (no DB). If `DATABASE_URL` is set, expect FAIL — methods not implemented.

- [ ] **Step 6.2: Add v7 migration**

In `packages/store-postgres/src/postgres-store.ts`, find the `MIGRATIONS: string[]` array (around line 29). Add a new entry to the END of the array (after v6, which is the `ar_runs` migration):

```ts
  // v7: Traces — span trees for observability. Two tables: spans (row per
  // span, one trace = many rows) and trace_summaries (precomputed roll-up).
  `
  CREATE TABLE IF NOT EXISTS ar_spans (
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
    status       TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
    error        TEXT,
    attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
    events       JSONB NOT NULL DEFAULT '[]'::jsonb,
    scores       JSONB NOT NULL DEFAULT '{}'::jsonb,
    cost_usd     NUMERIC(12,6)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_started
    ON ar_spans (owner_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_trace ON ar_spans (trace_id);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_parent
    ON ar_spans (parent_id) WHERE parent_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_name_started
    ON ar_spans (owner_id, name, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_spans_owner_run
    ON ar_spans (owner_id, run_id) WHERE run_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS ar_trace_summaries (
    trace_id       TEXT PRIMARY KEY,
    owner_id       TEXT NOT NULL,
    root_name      TEXT NOT NULL,
    agent_id       TEXT,
    started_at     TIMESTAMPTZ NOT NULL,
    ended_at       TIMESTAMPTZ,
    duration_ms    INTEGER,
    span_count     INTEGER NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('running','ok','error','cancelled')),
    total_tokens   INTEGER NOT NULL DEFAULT 0,
    total_cost_usd NUMERIC(12,6)
  );
  CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_started
    ON ar_trace_summaries (owner_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ar_trace_summaries_owner_agent
    ON ar_trace_summaries (owner_id, agent_id) WHERE agent_id IS NOT NULL;

  UPDATE ar_schema_version SET version = 7;
  `,
```

The existing migration loop applies this on next store construction.

- [ ] **Step 6.3: Implement the eight TraceStore methods on `PostgresStore`**

After the `═══ RunStore ═══` section in `packages/store-postgres/src/postgres-store.ts` (around line 888, after `listSubtree`), add:

```ts
  // ═══ TraceStore ═══

  async insertSpan(span: Span): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `INSERT INTO ${this.t("spans")} (
        span_id, trace_id, parent_id, owner_id, run_id, session_id,
        name, kind, started_at, ended_at, duration_ms, status, error,
        attributes, events, scores, cost_usd
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      ON CONFLICT (span_id) DO UPDATE SET
        trace_id    = EXCLUDED.trace_id,
        parent_id   = EXCLUDED.parent_id,
        owner_id    = EXCLUDED.owner_id,
        run_id      = EXCLUDED.run_id,
        session_id  = EXCLUDED.session_id,
        name        = EXCLUDED.name,
        kind        = EXCLUDED.kind,
        started_at  = EXCLUDED.started_at,
        ended_at    = EXCLUDED.ended_at,
        duration_ms = EXCLUDED.duration_ms,
        status      = EXCLUDED.status,
        error       = EXCLUDED.error,
        attributes  = EXCLUDED.attributes,
        events      = EXCLUDED.events,
        scores      = EXCLUDED.scores,
        cost_usd    = EXCLUDED.cost_usd`,
      [
        span.spanId, span.traceId, span.parentId, span.ownerId, span.runId, span.sessionId,
        span.name, span.kind, span.startedAt, span.endedAt, span.durationMs, span.status, span.error,
        JSON.stringify(span.attributes), JSON.stringify(span.events), JSON.stringify(span.scores),
        span.costUsd,
      ]
    );
  }

  async insertSpansBatch(spans: Span[]): Promise<void> {
    if (spans.length === 0) return;
    await this.ensureMigrated();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const s of spans) {
        await client.query(
          `INSERT INTO ${this.t("spans")} (
            span_id, trace_id, parent_id, owner_id, run_id, session_id,
            name, kind, started_at, ended_at, duration_ms, status, error,
            attributes, events, scores, cost_usd
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
          ON CONFLICT (span_id) DO NOTHING`,
          [
            s.spanId, s.traceId, s.parentId, s.ownerId, s.runId, s.sessionId,
            s.name, s.kind, s.startedAt, s.endedAt, s.durationMs, s.status, s.error,
            JSON.stringify(s.attributes), JSON.stringify(s.events), JSON.stringify(s.scores),
            s.costUsd,
          ]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async updateSpan(spanId: string, ownerId: string, patch: Partial<Span>): Promise<void> {
    await this.ensureMigrated();
    const sets: string[] = [];
    const args: unknown[] = [];
    let i = 1;
    if ("endedAt" in patch) { sets.push(`ended_at = $${i++}`); args.push(patch.endedAt); }
    if ("durationMs" in patch) { sets.push(`duration_ms = $${i++}`); args.push(patch.durationMs); }
    if ("status" in patch) { sets.push(`status = $${i++}`); args.push(patch.status); }
    if ("error" in patch) { sets.push(`error = $${i++}`); args.push(patch.error); }
    if ("attributes" in patch) { sets.push(`attributes = $${i++}`); args.push(JSON.stringify(patch.attributes)); }
    if ("events" in patch) { sets.push(`events = $${i++}`); args.push(JSON.stringify(patch.events)); }
    if ("scores" in patch) { sets.push(`scores = $${i++}`); args.push(JSON.stringify(patch.scores)); }
    if ("costUsd" in patch) { sets.push(`cost_usd = $${i++}`); args.push(patch.costUsd); }
    if (sets.length === 0) return;
    args.push(spanId, ownerId);
    await this.pool.query(
      `UPDATE ${this.t("spans")} SET ${sets.join(", ")}
       WHERE span_id = $${i++} AND owner_id = $${i++}`,
      args
    );
  }

  async upsertSummary(summary: TraceSummary): Promise<void> {
    await this.ensureMigrated();
    await this.pool.query(
      `INSERT INTO ${this.t("trace_summaries")} (
        trace_id, owner_id, root_name, agent_id, started_at, ended_at,
        duration_ms, span_count, status, total_tokens, total_cost_usd
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (trace_id) DO UPDATE SET
        owner_id       = EXCLUDED.owner_id,
        root_name      = EXCLUDED.root_name,
        agent_id       = EXCLUDED.agent_id,
        started_at     = EXCLUDED.started_at,
        ended_at       = EXCLUDED.ended_at,
        duration_ms    = EXCLUDED.duration_ms,
        span_count     = EXCLUDED.span_count,
        status         = EXCLUDED.status,
        total_tokens   = EXCLUDED.total_tokens,
        total_cost_usd = EXCLUDED.total_cost_usd`,
      [
        summary.traceId, summary.ownerId, summary.rootName, summary.agentId,
        summary.startedAt, summary.endedAt, summary.durationMs, summary.spanCount,
        summary.status, summary.totalTokens, summary.totalCostUsd,
      ]
    );
  }

  async getTrace(traceId: string, ownerId: string): Promise<Span[]> {
    await this.ensureMigrated();
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.t("spans")}
       WHERE trace_id = $1 AND owner_id = $2
       ORDER BY started_at ASC, span_id ASC`,
      [traceId, ownerId]
    );
    return rows.map(pgRowToSpan);
  }

  async getSummary(traceId: string, ownerId: string): Promise<TraceSummary | null> {
    await this.ensureMigrated();
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.t("trace_summaries")}
       WHERE trace_id = $1 AND owner_id = $2`,
      [traceId, ownerId]
    );
    return rows.length === 0 ? null : pgRowToSummary(rows[0]);
  }

  async listTraces(filter: TraceFilter): Promise<{ rows: TraceSummary[]; cursor?: string }> {
    await this.ensureMigrated();
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const clauses = [`owner_id = $1`];
    const args: unknown[] = [filter.ownerId];
    let i = 2;
    if (filter.agentId) { clauses.push(`agent_id = $${i++}`); args.push(filter.agentId); }
    if (filter.status) { clauses.push(`status = $${i++}`); args.push(filter.status); }
    if (filter.startedAfter) { clauses.push(`started_at >= $${i++}`); args.push(filter.startedAfter); }
    if (filter.startedBefore) { clauses.push(`started_at <= $${i++}`); args.push(filter.startedBefore); }
    if (filter.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(filter.cursor, "base64url").toString("utf8")) as {
          startedAt: string;
          traceId: string;
        };
        clauses.push(
          `(started_at < $${i} OR (started_at = $${i} AND trace_id < $${i + 1}))`
        );
        args.push(decoded.startedAt, decoded.traceId);
        i += 2;
      } catch {
        // ignore bad cursor
      }
    }
    args.push(limit);
    const { rows } = await this.pool.query(
      `SELECT * FROM ${this.t("trace_summaries")}
       WHERE ${clauses.join(" AND ")}
       ORDER BY started_at DESC, trace_id DESC
       LIMIT $${i}`,
      args
    );
    const summaries = rows.map(pgRowToSummary);
    const cursor =
      summaries.length === limit
        ? Buffer.from(
            JSON.stringify({
              startedAt: summaries[summaries.length - 1].startedAt,
              traceId: summaries[summaries.length - 1].traceId,
            })
          ).toString("base64url")
        : undefined;
    return { rows: summaries, cursor };
  }

  async deleteTrace(traceId: string, ownerId: string): Promise<void> {
    await this.ensureMigrated();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM ${this.t("spans")} WHERE trace_id = $1 AND owner_id = $2`,
        [traceId, ownerId]
      );
      await client.query(
        `DELETE FROM ${this.t("trace_summaries")} WHERE trace_id = $1 AND owner_id = $2`,
        [traceId, ownerId]
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async deleteOlderThan(ownerId: string, before: Date): Promise<number> {
    await this.ensureMigrated();
    const beforeIso = before.toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: tids } = await client.query(
        `SELECT trace_id FROM ${this.t("trace_summaries")}
         WHERE owner_id = $1 AND started_at < $2`,
        [ownerId, beforeIso]
      );
      const traceIds: string[] = tids.map((r: { trace_id: string }) => r.trace_id);
      if (traceIds.length > 0) {
        await client.query(
          `DELETE FROM ${this.t("spans")}
           WHERE owner_id = $1 AND trace_id = ANY($2::text[])`,
          [ownerId, traceIds]
        );
        await client.query(
          `DELETE FROM ${this.t("trace_summaries")}
           WHERE owner_id = $1 AND trace_id = ANY($2::text[])`,
          [ownerId, traceIds]
        );
      }
      await client.query("COMMIT");
      return traceIds.length;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
```

Add row-mapper helpers at the bottom of `postgres-store.ts` (next to the existing `rowToRun`):

```ts
function pgRowToSpan(r: Record<string, unknown>): Span {
  return {
    spanId: r.span_id as string,
    traceId: r.trace_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    ownerId: r.owner_id as string,
    runId: (r.run_id as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    name: r.name as string,
    kind: r.kind as Span["kind"],
    startedAt: (r.started_at instanceof Date ? (r.started_at as Date).toISOString() : (r.started_at as string)),
    endedAt:
      r.ended_at == null
        ? null
        : r.ended_at instanceof Date
          ? (r.ended_at as Date).toISOString()
          : (r.ended_at as string),
    durationMs: (r.duration_ms as number | null) ?? null,
    status: r.status as Span["status"],
    error: (r.error as string | null) ?? null,
    attributes: (r.attributes as Record<string, unknown>) ?? {},
    events: (r.events as Span["events"]) ?? [],
    scores: (r.scores as Span["scores"]) ?? {},
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
  };
}

function pgRowToSummary(r: Record<string, unknown>): TraceSummary {
  return {
    traceId: r.trace_id as string,
    ownerId: r.owner_id as string,
    rootName: r.root_name as string,
    agentId: (r.agent_id as string | null) ?? null,
    startedAt: (r.started_at instanceof Date ? (r.started_at as Date).toISOString() : (r.started_at as string)),
    endedAt:
      r.ended_at == null
        ? null
        : r.ended_at instanceof Date
          ? (r.ended_at as Date).toISOString()
          : (r.ended_at as string),
    durationMs: (r.duration_ms as number | null) ?? null,
    spanCount: r.span_count as number,
    status: r.status as TraceSummary["status"],
    totalTokens: r.total_tokens as number,
    totalCostUsd: r.total_cost_usd == null ? null : Number(r.total_cost_usd),
  };
}
```

Add imports at the top:

```ts
import type {
  // …existing
  Span,
  TraceSummary,
  TraceFilter,
} from "@agntz/core";
```

- [ ] **Step 6.4: Run the conformance suite against a real Postgres**

You need `DATABASE_URL` set. From the repo root:

```bash
docker compose up -d postgres
export DATABASE_URL=postgres://agntz:agntz@localhost:5432/agntz
cd packages/store-postgres
pnpm test trace-store
```

Expected: all 18 conformance tests PASS.

If `DATABASE_URL` is unset, the suite uses `skipIf` and the test prints `skipped` — that's only acceptable when verifying types/imports during local dev. For the slice's actual sign-off, **the suite must be run with a real DB**.

- [ ] **Step 6.5: Verify migration runs cleanly on a fresh and existing DB**

Fresh DB:

```bash
docker compose down -v
docker compose up -d postgres
sleep 3
export DATABASE_URL=postgres://agntz:agntz@localhost:5432/agntz
cd packages/store-postgres
pnpm test trace-store
```

Expected: tests pass (migration applied from v0 → v7 in one go).

Existing DB (simulate a deployment with an existing v6 schema):

```bash
# Reset to a clean DB
docker compose down -v
docker compose up -d postgres
sleep 3
# Apply v1–v6 by creating a store WITHOUT the v7 migration in place — checkout main briefly
git stash
cd packages/store-postgres && pnpm test run-store && cd ../..
git stash pop
# Now run trace-store tests; migration should advance v6 → v7 cleanly
cd packages/store-postgres
pnpm test trace-store
```

Expected: tests pass. The `ar_schema_version.version` value reads 7 after the run; verify with:

```bash
docker compose exec postgres psql -U agntz -c "SELECT version FROM ar_schema_version;"
```

Expected: `version | 7`.

- [ ] **Step 6.6: Run full Postgres test suite**

```bash
cd packages/store-postgres
pnpm test
```

Expected: all tests pass (run-store + trace-store + existing).

- [ ] **Step 6.7: Commit**

```bash
git add packages/store-postgres/src/postgres-store.ts packages/store-postgres/tests/trace-store.test.ts
git commit -m "$(cat <<'EOF'
postgres: implement TraceStore + v7 migration

Adds ar_spans + ar_trace_summaries tables. Five indexes on ar_spans (owner+
started, trace, parent, owner+name+started, owner+run); two on summaries.
Batched inserts transactional. Owner-scoped on every method. Passes the 18-test
conformance suite against a real Postgres.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Export new types + repo-wide verification

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 7.1: Check what `index.ts` currently exports**

```bash
cd packages/core
grep -n "^export" src/index.ts | head -30
```

Note: confirm `Run`, `RunStatus`, `RunStore`, `RunRegistry` are already exported (from PR #19). The new types follow that pattern.

- [ ] **Step 7.2: Add type exports**

Open `packages/core/src/index.ts`. Find the block where `Run`/`RunStatus`/`RunStore` are exported (look for `export type { Run, …`). Extend that export block:

```ts
export type {
  // …existing exports
  Run,
  RunStatus,
  RunRegistry,
  RunStore,
  // ← add these:
  Span,
  SpanKind,
  SpanStatus,
  TraceSummary,
  TraceFilter,
  TraceLiveEvent,
  TraceStore,
} from "./types.js";
```

- [ ] **Step 7.3: Verify all packages typecheck and build**

```bash
cd /Users/aaronparry/Developer/GymText/agntz
pnpm install   # in case symlinks need refresh after type changes
pnpm build
pnpm test
```

Expected: all builds succeed, all tests pass (memory + json + sqlite + postgres conformance).

If a downstream package (`@agntz/worker`, `@agntz/sdk`, `@agntz/app`) fails to typecheck because it references `UnifiedStore` and the new method signatures don't conform somewhere unexpected, investigate. The most likely failure: `MemoryStore` claims to be a `UnifiedStore` but is missing a method. Re-verify Task 3.

- [ ] **Step 7.4: Final commit**

```bash
git add packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
core: export Span, TraceStore, and related types from public API

Slice 4 complete. Span persistence is now usable from any package — Slice 5
(span emission) consumes these types when wiring SpanEmitter and TraceRegistry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Open the PR

- [ ] **Step 8.1: Push the branch**

```bash
git push -u origin slice-4-trace-store
```

- [ ] **Step 8.2: Open PR with body referencing the spec**

```bash
gh pr create --title "Tracing v1 Slice 1: TraceStore foundation" --body "$(cat <<'EOF'
## Summary
- Adds `TraceStore` interface to `@agntz/core` (`Span`, `TraceSummary`, `TraceFilter`, `TraceLiveEvent`).
- Implements `TraceStore` on all four backends (memory, JSON file, SQLite, Postgres).
- v7 migration on Postgres creates `ar_spans` + `ar_trace_summaries` with appropriate indexes.
- 18-case shared conformance suite — every backend passes the same tests.

Spec: `docs/superpowers/specs/2026-05-11-tracing-v1-design.md` (Sections 5, 9, 13).
Next slice: span emission (`SpanEmitter`, `TraceRegistry`, runner/manifest integration).

## Test plan
- [ ] `pnpm test` from repo root — all packages pass
- [ ] `pnpm build` from repo root — all packages build
- [ ] Run `packages/store-postgres/tests/trace-store.test.ts` against a real Postgres (DATABASE_URL set)
- [ ] Verify migration v6 → v7 advances cleanly: `SELECT version FROM ar_schema_version;` returns `7`
- [ ] Cross-backend behavior identical (same conformance suite passes everywhere)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. Done with Slice 1.

---

## What's left (next slices)

| Slice | Spec section | Plan filename |
|---|---|---|
| 2 — Span emission + TraceRegistry + runner/manifest integration | 4, 6, 9 | `2026-05-11-tracing-v1-slice-2-emission.md` (write after Slice 1 lands) |
| 3 — `/traces/*` HTTP + `TracesResource` SDK | 7 | `2026-05-11-tracing-v1-slice-3-http.md` |
| 4 — agntz.co UI | 8 | `2026-05-11-tracing-v1-slice-4-ui.md` |

Each subsequent slice's plan should be written *after* the prior slice lands, so it can incorporate any deviations from the spec discovered during implementation.

---

## Self-review notes

- **Spec coverage:** Section 5 (data model) → Tasks 1, 5, 6. Section 9 (retention via `deleteOlderThan`) → all backends. Section 13 (slice scope) → matches. Section 6 emission and Section 7 routes are explicitly NOT in this slice (they're Slices 2 and 3).
- **Placeholder scan:** No `TBD`/"implement appropriate"/"similar to" placeholders. The only `TODO` is the deliberate failing stub in Step 1.1 (replaced in Step 1.2).
- **Type consistency:** Method signatures (`insertSpan(span)`, `updateSpan(spanId, ownerId, patch)`, `getTrace(traceId, ownerId)`, etc.) match exactly across the type definition (Task 1), conformance suite (Task 2), and all four backend implementations (Tasks 3–6). The `ownerId` arg ordering is consistent everywhere.
- **Commands and paths:** All `pnpm test`, `pnpm typecheck`, `pnpm build`, `gh pr create`, `docker compose` commands verified against the repo's existing scripts and infrastructure.
