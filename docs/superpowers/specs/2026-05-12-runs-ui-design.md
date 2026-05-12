# Runs UI — design spec

**Date:** 2026-05-12
**Branch:** `slice-8-runs-ui` (single PR)
**Status:** approved for implementation planning

---

## 1. Context

The runs HTTP surface (`POST /runs`, `GET /runs/:id`, `GET /runs/:id/stream`, `POST /runs/:id/cancel`) and SDK `RunsResource` shipped in PR #23. The traces UI shipped in PR #25. There is currently **no UI for runs** in `packages/app`, and no `GET /runs` list endpoint on the worker.

This spec covers a self-contained slice that adds an end-to-end `/runs` UI: list page, detail page with transcript layout, polling refresh for in-progress runs, and a cancel action. It also adds the missing `listRuns` capability to the data layer because the list page can't exist without it.

---

## 2. Goals & non-goals

### Goals
- Browse history of runs the system has processed (filter by agent, status, time range)
- Inspect a finished run end-to-end: input, tool calls (with I/O), spawned sub-runs, output, usage
- Cancel an in-progress run with a confirmation step
- Reuse existing primitives (`StatusBadge`, `RelativeTime`, `JsonView`, `CardMessage`) and the slice 7 layout shell

### Non-goals (v1)
- True live tail via SSE (`/api/runs/[runId]/stream`) — polling instead
- Streaming `text-delta` rendering inside the transcript
- Search / full-text input filter
- Bulk operations (cancel many, delete many)
- A separate Runs visualization in the traces UI (kept independent)

---

## 3. Approach

**One slice, one PR.** Branch `slice-8-runs-ui`, many small commits, single review. Mirrors how slice 7 was scoped and merged.

The work splits cleanly into two layers but ships together:

- **Backend layer** — `RunStore.listRuns` on memory / json-file / sqlite / postgres; worker `GET /runs` route; SDK `RunsResource.list()`; conformance tests
- **Frontend layer** — three Next API proxies (`/api/runs`, `/api/runs/[runId]`, `/api/runs/[runId]/cancel`); `/runs` list page; `/runs/[runId]` detail page (transcript + sidebar); polling hook; cancel button with confirm dialog

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Next.js app (packages/app)                                  │
│                                                              │
│  /runs                       /runs/[runId]                   │
│   ├─ RunsTable               ├─ RunHeader (status + Cancel)  │
│   └─ filters                 ├─ RunTranscript                │
│        (agent/status/range)  │   ├─ InputBubble              │
│                              │   ├─ ToolCallRow ×N           │
│                              │   ├─ SpawnAgentRow ×N         │
│                              │   └─ OutputBubble             │
│                              └─ RunSidebar                   │
│                                  ├─ UsageTile                │
│                                  ├─ ChildrenList             │
│                                  └─ TraceLink → /traces/:id  │
│                                                              │
│  Next API proxies (worker-runs helper, mirrors worker-traces)│
│   GET  /api/runs                  → worker GET  /runs        │
│   GET  /api/runs/[runId]          → worker GET  /runs/:id    │
│   POST /api/runs/[runId]/cancel   → worker POST /runs/:id/cancel│
└────────────────────────┬─────────────────────────────────────┘
                         │ X-User-Id + Bearer <INTERNAL_SECRET>
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Worker (packages/worker)                                    │
│   GET /runs             ── new ──                            │
│   GET /runs/:id         (existing)                           │
│   POST /runs/:id/cancel (existing)                           │
└────────────────────────┬─────────────────────────────────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  RunStore (packages/core, +4 backends)                       │
│   listRuns(filters) ── new ──                                │
│   getRun / putRun / listChildren / listSubtree (existing)    │
└──────────────────────────────────────────────────────────────┘
```

### Data flow — list page

1. Page mounts → `fetch('/api/runs?status=ok&startedAfter=...&limit=50')`
2. Next route attaches `X-User-Id` from session + internal-secret bearer → calls worker `GET /runs`
3. Worker → `store.forUser(userId).listRuns(filters)` → returns `{ rows: Run[], cursor? }`
4. Page renders `<RunsTable>` with cursor-driven "Load more"

### Data flow — detail page

1. Page mounts → `fetch('/api/runs/[runId]')` → returns `Run`
2. If `status === "running"`, start `setInterval(2000)` polling the same endpoint; clear on terminal status, unmount, or `runId` change
3. Cancel click → confirm dialog → `POST /api/runs/[runId]/cancel` → next polling tick reflects new status

### List query semantics

Defaults to `rootsOnly=true` (only `depth=0` runs). The flag is passed through worker → store so SQL backends can use a partial index. Memory / json-file backends filter in-process.

---

## 5. Backend changes

### 5.1 `RunStore.listRuns` — interface (packages/core)

```ts
interface RunListFilters {
  rootsOnly?: boolean;        // default true
  agentId?: string;
  status?: RunStatus;
  startedAfter?: string;      // ISO 8601
  startedBefore?: string;     // ISO 8601
  limit?: number;             // default 50, max 200
  cursor?: string;            // opaque, encodes (startedAt, id)
}

interface RunListResult {
  rows: Run[];
  cursor?: string;
}

interface RunStore {
  // ...existing
  listRuns(filters: RunListFilters): Promise<RunListResult>;
}
```

User-scoping is implicit (store is accessed via `store.forUser(userId)`). Cursor is base64-encoded `{ startedAt, id }` for stable ordering — same shape `TraceStore` uses.

### 5.2 Per-backend implementation

The `ar_runs` table already exists (added in PR #23) with indexes on `(user_id, parent_id)`, `(user_id, root_id)`, and `(user_id, status)`. The only DDL change is adding `(user_id, started_at DESC)` for the list-page primary sort, using the same idempotent `CREATE INDEX IF NOT EXISTS` pattern.

- **memory** — filter the `Map<id, Run>`, sort by `startedAt DESC, id DESC`, slice to limit
- **json-file** — same as memory (in-memory map persisted to disk)
- **sqlite** — `SELECT * FROM ar_runs WHERE user_id = ? AND (?rootsOnly = 0 OR parent_id IS NULL) AND ... ORDER BY started_at DESC, id DESC LIMIT ?`. Add the new index above
- **postgres** — same query parameterized; same new index. Consider a partial index `WHERE parent_id IS NULL` if benchmarks show the rootsOnly fast path needs it (skip preemptively)

### 5.3 Worker route (packages/worker)

```ts
app.get("/runs", async (c) => {
  const userId = c.get("userId");
  const filters = parseRunListFilters(c.req.query());  // zod
  const result = await store.forUser(userId).listRuns(filters);
  return c.json(result);
});
```

Reuses existing `workerAuth` middleware on `/runs`. No new auth surface.

### 5.4 SDK (packages/sdk)

Adds to `RunsResource`:

```ts
async list(
  filter: RunListFilter = {},
  opts: { signal?: AbortSignal } = {},
): Promise<RunListResult>
```

Plus `RunListFilter` and `RunListResult` types in `packages/sdk/src/types.ts`, hand-mirrored from core (matches the pattern used for trace types in slice 6).

---

## 6. Frontend — Next API proxies

New helper `packages/app/src/lib/worker-runs.ts`:

```ts
export async function workerRunsFetch(req, path, init?): Promise<Response>
```

Identical shape to `worker-traces`: pulls `userId` from session, attaches `X-User-Id` + `Authorization: Bearer <INTERNAL_SECRET>`, prefixes `WORKER_URL`, returns the raw `Response`.

Routes:

```
packages/app/src/app/api/runs/
  ├─ route.ts                     GET  → worker GET  /runs?<query>
  ├─ [runId]/
  │   ├─ route.ts                 GET  → worker GET  /runs/:id
  │   └─ cancel/route.ts          POST → worker POST /runs/:id/cancel
```

Each handler is ~15 lines: parse params, call `workerRunsFetch`, forward status + body. No business logic in the Next layer.

---

## 7. Frontend — list page (`/runs`)

`packages/app/src/app/runs/page.tsx` — client component, near-clone of `/traces/page.tsx`.

**State:** `agentFilter`, `statusFilter`, `hoursFilter`, `rows`, `cursor`, `loading`, `loadingMore`, `error`.

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  Runs                                                       │
│  Inspect every agent invocation. Click into a row...        │
│                                                             │
│  [Any agent ▾] [Any status ▾] [Last 24h ▾]                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Status  Agent      Input              When  Dur Cost│    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ● ok    refactor   Refactor the auth… 2m   5.1s $.04│    │
│  │ ● err   reviewer   Review PR #42…     5m   1.2s $.01│    │
│  │ ● run   builder    Build the dashbo…  now  —    —   │    │
│  └─────────────────────────────────────────────────────┘    │
│                       [ Load more ]                         │
└─────────────────────────────────────────────────────────────┘
```

### `<RunsTable rows>` (`components/runs/runs-table.tsx`)

One row per run, each row links to `/runs/[id]`. Columns:

- **Status** — reused `<StatusBadge>` (from slice 7), maps `RunStatus` → color (ok→green, error/failed→red, cancelled→amber, running/pending/draining→blue)
- **Agent** — monospace text
- **Input** — `truncate` of `run.input` to ~80 chars, sans-serif
- **Started** — reused `<RelativeTime>`
- **Duration** — `formatDurationMs(endedAt - startedAt)` or `—` if running
- **Cost** — `$<n>` from `run.result?.usage` × model pricing, or `—` if no result

### Filters

Same `<FilterSelect>` as traces. Status options reflect `RunStatus` (not `SpanStatus`).

### Empty / loading / error

Same `<CardMessage>` pattern. Empty copy: "No runs yet. Runs appear here when you start an agent."

### Sidebar nav

Add `{ href: '/runs', label: 'Runs' }` to the sidebar that holds the existing `/traces` link.

---

## 8. Frontend — detail page (`/runs/[runId]`)

`packages/app/src/app/runs/[runId]/page.tsx` — client component, transcript + sidebar layout.

```
┌──────────────────────────────────────────────────────────────────┐
│  ← Runs                                                          │
│                                                                  │
│  refactor · run_a1b2c3                                  [Cancel] │
│  ● ok · started 2m ago · 5.1s · $0.04                            │
│                                                                  │
│  ┌──────────────────────────────────────┐  ┌─────────────────┐   │
│  │ INPUT                                │  │ USAGE           │   │
│  │ "Refactor the auth module..."        │  │ 8.4k tok        │   │
│  ├──────────────────────────────────────┤  │ $0.04           │   │
│  │ → read_file("auth.ts")        142ms ▸│  │ 5.1s · gpt-4o   │   │
│  ├──────────────────────────────────────┤  └─────────────────┘   │
│  │ ↳ spawned reviewer            2.1s ▸ │  ┌─────────────────┐   │
│  │   ● ok · 3 tool calls                │  │ CHILDREN (1)    │   │
│  ├──────────────────────────────────────┤  │ • reviewer ● ok │   │
│  │ → write_file("auth.ts")        89ms ▸│  └─────────────────┘   │
│  ├──────────────────────────────────────┤  ┌─────────────────┐   │
│  │ OUTPUT                               │  │ TRACE           │   │
│  │ "Done. Extracted session logic..."   │  │ View spans →    │   │
│  └──────────────────────────────────────┘  └─────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### Components (all new under `components/runs/`)

- **`<RunHeader run>`** — title (agent · short id), `<StatusBadge>`, `<RelativeTime>`, duration, cost. Cancel button (right-aligned) when `status === "running"`.
- **`<CancelButton runId>`** — opens `<ConfirmDialog>` ("Cancel this run? It will cascade to all spawned children."), on confirm POSTs `/api/runs/[runId]/cancel`. Disabled while in-flight. Toast or inline error on failure.
- **`<RunTranscript run>`** — renders, in order: `<InputBubble>`, then for each entry in `run.result?.toolCalls ?? []` either a `<SpawnAgentRow>` (when `toolCall.name === "spawn_agent"`) or `<ToolCallRow>`, then `<OutputBubble>` (only if `result?.output` present). If `error` is present (failed run), `<ErrorBubble>` replaces the output bubble. If `status === "running"`, append a `<RunningIndicator>` ("Agent is working…") below the last rendered row.
  - **`<InputBubble text>`** — stone background, sans-serif. Monospace fallback for code-y inputs (heuristic: starts with `{` or contains triple-backticks).
  - **`<ToolCallRow toolCall>`** — collapsed: name, duration, error indicator. Click to expand → `<JsonView>` (reused) for input and output side-by-side.
  - **`<SpawnAgentRow toolCall>`** — visually distinct (left-border accent). Shows "↳ spawned `<agent>`" with status badge + child run summary (tool call count, duration). Whole row is a `<Link href="/runs/[childId]">`. Child `runId` parsed from `toolCall.output` (the spawn_agent return value contains the spawned run's id).
  - **`<OutputBubble text>`** — blue tint, sans-serif, same code heuristic.
- **`<RunSidebar run>`** — three cards:
  - **Usage** — tokens, cost, duration, model
  - **Children** — list of direct children with status badges + links
  - **Trace** — link to `/traces/[run.rootId]` (always rendered; if no trace exists, the traces detail page 404s — acceptable for v1)

### Polling hook — `useRunPolling(runId, initialRun)`

```
- Returns { run, error }.
- On mount: holds initialRun.
- If run.status === "running": setInterval(2000) → fetch /api/runs/[runId] → setState.
- Stops polling once a terminal status is observed.
- Cleans up on unmount or runId change.
```

### Reused from slice 7

`<StatusBadge>`, `<RelativeTime>`, `<JsonView>`, `<CardMessage>`, the `mx-auto max-w-7xl` container shell.

### Loading / not-found / error

Same `<CardMessage>` pattern as the traces detail page.

---

## 9. Edge cases

- **Run with no `result`** (running, or failed before completing): transcript shows input + running/error indicator; no tool-calls iteration crash
- **Run with empty `toolCalls`**: jump straight from input → output (or running indicator)
- **`spawn_agent` output that doesn't match expected shape**: `<SpawnAgentRow>` falls back to rendering as a normal `<ToolCallRow>` rather than crashing
- **Cancel race**: user clicks cancel, server returns 409 (already terminal) → toast "Run already finished" and refetch
- **Polling on a terminal run loaded fresh**: never starts (guard on `status !== "running"`)
- **Polling when tab backgrounded**: browser throttles `setInterval` automatically; no extra logic needed
- **Cost when no `result.usage`**: render `—` not `$NaN`
- **Very long input/output strings**: bubbles wrap with `max-h` + scroll
- **Trace link for runs that predate tracing v1**: always render the link; `/traces/[rootId]` 404s if no trace exists (acceptable for v1)

---

## 10. Testing strategy

| Layer | What | Where |
|---|---|---|
| Core | `run-store-conformance.ts` — listRuns: empty, ordering, rootsOnly, each filter, cursor pagination, user isolation | new shared file run against all 4 backends |
| Worker | `tests/runs-list-route.test.ts` — auth gate, query parsing (zod), owner scoping, 4xx on bad cursor | new |
| SDK | `tests/client.runs.list.test.ts` — URL construction with each filter combo, response shape, auth header | new |
| App | None — consistent with rest of `packages/app` (no test infra). Verified visually. | — |

Worker E2E (`span-emission-e2e.test.ts` style) is not added — the list endpoint is mechanically simple and the conformance tests cover the data layer.

---

## 11. Verification before PR

Per the project pattern: build, typecheck, run all tests across packages, then visually walk through the golden paths before opening the PR.

Golden paths to walk:
1. Start a run via existing UI/CLI → see it appear in `/runs` list
2. Click into the run → see input bubble, tool call rows, output bubble
3. Find a run with `spawn_agent` tool calls → confirm sub-run row links into the child's detail page
4. Find a run with a `rootId` that has a trace → confirm the Trace sidebar link opens the right `/traces/[id]` page
5. Start a long-running agent → load its detail page → confirm polling updates status / fields every ~2s
6. While a run is running, click Cancel → confirm dialog → confirm → confirm status flips to `cancelled` on next poll
7. Filter the list by agent / status / time range → confirm correct rows / `Load more` cursor behavior

---

## 12. Open questions / TBD in implementation

- **Cost computation source.** Reuse `model-pricing.ts` from core (already wired into traces UI via span attributes), or compute client-side from `run.result.usage` × per-model rate? Defer to implementation; whichever is already exposed cleanly.
- **`spawn_agent` output shape.** Confirm the exact field name for the spawned `runId` in the tool call's `output` value when implementing `<SpawnAgentRow>` — likely `{ runId, agentId }` but verify against the actual `spawn-agent` tool source.
- **Status badge color for `draining`.** Likely the same blue as `running`, but confirm with existing `StatusBadge` color map and add the missing case if absent.
