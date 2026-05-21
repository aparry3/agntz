# Playground in Editor — Implementation Plan

Hook up the unwired "Playground" button in `/agents/[id]/page.tsx` so users can run an agent (LLM or pipeline) with structured inputs and watch a live trace render in the right pane, side-by-side with the manifest.

**Status**: Phase 0 (discovery) complete. Phases 1–8 are sequenced so each layer is independently verifiable: core → worker → API proxies → UI scaffolding → UI panel.

---

## Phase 0 — Documentation Discovery (DONE)

Two subagents extracted concrete facts. Findings consolidated into the **Allowed APIs** list below. Anti-patterns are flagged where the discovery surfaced "this doesn't exist."

### Allowed APIs (verified to exist, cite source on use)

**Core types** (`packages/core/src/types.ts`)
- `TraceLiveEvent` = `{type:"span-start";span:Span} | {type:"span-end";spanId;patch} | {type:"trace-done";summary:TraceSummary}` — types.ts:1059-1062
- `TraceSummary` — types.ts:1031-1043 (no `source` field; do not invent one)
- `Span` — has `spanId, traceId, parentId, ownerId, runId, sessionId, name, kind, startedAt, endedAt, durationMs, status, error, attributes, events, scores, costUsd`
- `SessionSummary = { sessionId; agentId?; messageCount; createdAt; updatedAt }` — types.ts:392-398
- `SessionStore.listSessions(agentId?): Promise<SessionSummary[]>` — types.ts:698

**SpanEmitter / Telemetry** (`packages/core/src/telemetry.ts`)
- `class SpanEmitter` (telemetry.ts:106-412); `class Telemetry extends SpanEmitter` (line 418)
- `TelemetryConfig` (lines 40-53): `tracer`, `tracerName`, `recordIO`, `recordToolIO`, `baseAttributes`, `traceSink`. **No `traceId` field today** — Phase 1 adds it.
- `openSpan` (line 298) mints traceId via `\`tr_${ulid()}\`` when `this.stack` is empty and there's no explicit parent. `ulid()` defined at lines 474-476.

**TraceRegistry** (`packages/worker/src/trace-registry.ts`)
- Interface (lines 3-13): `spanStart`, `spanEnd`, `traceDone`, `subscribe`, `getInProgress`, `waitForFlush`. **No `register` method today** — Phase 2 adds one.
- `getInProgress(traceId, ownerId)` returns `null` when zero active spans match (NOT `[]`).
- `subscribe` is independent of `active`/store; subscribers attached after broadcast miss past events (no replay buffer).

**Worker routes** (`packages/worker/src/routes.ts`)
- `/run/stream` POST handler at lines 244-398. Today emits SSE events: `run-start { agentId, kind, sessionId }` (lines 357-360), `reply { type, runId, sessionId, text, ts, seq }` (lines 336-347), `run-complete { output, state, sessionId, replies? }` (lines 379-382), `run-error { error }` (lines 389-392). **No `traceId` in `run-start` today** — Phase 2 adds it.
- SSE write pattern: `await stream.writeSSE({ event, data: JSON.stringify(...) })` using `streamSSE` from `hono/streaming`.
- `traceRegistry` instantiated at lines 84-86 as `new InMemoryTraceRegistry({ store })`.
- `/traces/:id/stream` handler (lines 763-800) gates the live path on `getInProgress !== null`. Subscriber loop: `for await (const ev of traceRegistry.subscribe(traceId, userId))` writes `{ event: ev.type, data: JSON.stringify(ev) }`. After `trace-done` the registry closes the iterator and the SSE response ends.

**App API proxies** (verified passthrough — no parsing)
- `packages/app/src/app/api/run/stream/route.ts` — pipes `workerRunStream(...)` body to browser with SSE headers.
- `packages/app/src/app/api/traces/[id]/stream/route.ts` — same pattern.
- `packages/app/src/lib/worker-client.ts:workerRunStream` returns `ReadableStream<Uint8Array>` directly.
- `/api/sessions` GET (`packages/app/src/app/api/sessions/route.ts:1-16`) returns `SessionSummary[]`.
- `/api/run` POST (`packages/app/src/app/api/run/route.ts`) returns `{ output, state, sessionId, replies? }` — **no `traceId`** (won't be used by the playground; we use `/api/run/stream` instead).

**Manifest types** (`packages/manifest/src/types.ts`)
- `InputSchema = Record<string, PropertyDef>` — line 35
- `PropertyDef = string | PropertyDefExpanded` — line 37
- `PropertyDefExpanded = { type, default?, enum?, min?, max? }` — lines 39-45
- `Example = { input: string; output: string }` — line 118
- `inputSchema?: InputSchema` is on `AgentManifestBase` — applies to **all kinds** including `sequential` / `parallel`. `createInitialState` (state.ts:35) already places schema'd properties into state for every kind — pipelines included (sequential.ts:47, parallel.ts:19).

**Editor + view components** (`packages/app/src/components/v3/editor/`)
- `EditorShell` accepts `secondaryActions: ReactNode` slot (today's page already supplies one — agents/[id]/page.tsx:159-172).
- `SingleAgentView` props (lines 59-81): `manifest, manifestId, view, onChangeView, onChange?, catalog?, rightExtras?, yamlPanel?`. **No `rightPaneOverride` today** — Phase 4 adds it. Right pane renders at lines 234-243 inside the grid.
- `PipelineView` props (lines 55-74): same shape minus `rightExtras`. Right pane renders at lines 222-252.
- `SingleViewMode = "build" | "yaml" | "instruction" | "both"`; same for `PipelineViewMode`.

**Trace UI components** — all pure presentational, drop-in
- `GanttStrip` (`packages/app/src/components/traces/gantt-strip.tsx`): props `{ spans: Span[]; summary: TraceSummary; selectedSpanId: string | null; onSelect: (spanId: string) => void }`.
- `SpanTree` (`span-tree.tsx`): props `{ spans, selectedSpanId, onSelect }`.
- `SpanDetailPanel` (`span-detail-panel.tsx`): props `{ span: Span | null }`.

**Form primitives** — reuse from `packages/app/src/components/v3/editor/editable-fields.tsx`
- `EditableText({ label?, value, onChange, placeholder?, multiline?, rows?, mono? })`
- `EditableNumber({ label?, value, onChange, min?, max?, step?, placeholder?, hint? })`
- `EditableSelect<T>({ label?, value, options: ReadonlyArray<readonly [T, string]>, onChange })`
- `EditableToggle({ label, value, onChange, hint? })`
- Visual primitives from `v3/primitives`: `ag`, `Btn`, `Tag`, `Mono`, `Label`, `Spinner`, `Crumbs`
- Icons from `v3/icons`: `I.Play`, `I.X`, `I.Dot`, `I.Hist`, `I.Chev`, `I.ChevR`

### Anti-patterns (do NOT do these)

- ❌ **Do not** invent a `register()` method on `TraceRegistry` before Phase 2 implements it.
- ❌ **Do not** add a `source` field to `TraceSummary`, `TraceFilter`, or any TraceStore impl (deferred per locked decisions).
- ❌ **Do not** add a `play` value to `SingleViewMode`/`PipelineViewMode` — use the `rightPaneOverride` prop pattern instead (less enum churn).
- ❌ **Do not** call `traceRegistry.subscribe()` before the trace has been registered — it will work mechanically but `/traces/:id/stream` returns 404 because of the `getInProgress` gate.
- ❌ **Do not** poll/retry on the client — fix the race on the worker by pre-registering.
- ❌ **Do not** assume `getInProgress` returns `[]` for "no spans yet" — it returns `null` today.
- ❌ **Do not** rewrite the trace UI components — they are presentational and reusable as-is.
- ❌ **Do not** add a `traceId` field to `/api/run` (blocking) — the playground uses `/api/run/stream` and gets `traceId` from the first SSE frame.

---

## Phase 1 — Core: Allow injecting traceId into SpanEmitter

**Goal**: Let the worker pre-mint a `traceId` and pass it into the per-request `SpanEmitter` so the same id can be emitted in `run-start` and used by all spans.

### What to implement

1. In `packages/core/src/telemetry.ts`, add an optional `traceId?: string` field to `TelemetryConfig` (around lines 40-53). Keep the surrounding ordering and naming style consistent with the other fields.
2. Patch the line at telemetry.ts:298:
   - Before: `const traceId = parent ? parent.traceId : \`tr_${ulid()}\`;`
   - After: `const traceId = parent ? parent.traceId : (this.config.traceId ?? \`tr_${ulid()}\`);`
3. Export nothing new — `TelemetryConfig` is already exported.

### Documentation references

- `packages/core/src/telemetry.ts:40-53` (existing `TelemetryConfig`)
- `packages/core/src/telemetry.ts:298` (the `openSpan` traceId mint line)
- `packages/core/src/telemetry.ts:474-476` (ulid generator — leave untouched)

### Verification checklist

- [ ] `pnpm -F @agntz/core build` succeeds.
- [ ] `pnpm -F @agntz/core test` passes — no existing behavior change because new field is optional with same default.
- [ ] `grep -n "traceId" packages/core/src/telemetry.ts` — confirm the patched line uses `this.config.traceId ?? \`tr_${ulid()}\``.
- [ ] No callers of `SpanEmitter` need to change (the field is optional).

### Anti-pattern guards

- Do not change the `ulid()` helper. Do not change the `tr_` prefix.
- Do not require `traceId` — it must remain optional so all existing call sites (`/run` non-stream, tests, etc.) keep working.

---

## Phase 2 — Worker: Pre-mint traceId, pre-register trace, emit it in run-start

**Goal**: Eliminate the race where the client subscribes to `/traces/:id/stream` before the first `spanStart` lands. Pre-register the trace and surface `traceId` in `run-start`.

### What to implement

1. **TraceRegistry interface change** (`packages/worker/src/trace-registry.ts:3-13`): add `register(traceId: string, ownerId: string): void` to the interface. Implement in `InMemoryTraceRegistry`:
   - Maintain a `Set<string>` keyed by `${traceId}::${ownerId}` for "registered but no spans yet".
   - `register()` adds the key.
   - On the first `spanStart` for that key, remove the placeholder (or just let it coexist — see step 2).
   - On `traceDone`, remove the key as well.
2. **`getInProgress` change** (trace-registry.ts:160-166): return `[]` (empty array) when the trace is registered but has zero active spans, `null` only when the trace is unknown. This keeps the `/traces/:id/stream` live path enabled.
3. **`/run/stream` handler** (`packages/worker/src/routes.ts:244-398`):
   - Right after `sessionId` is allocated (line 259), mint `const traceId = \`tr_${randomBytes(8).toString("hex")}\`;`. **Note**: `randomBytes` is already imported at routes.ts:1.
   - Pass `traceId` into the `SpanEmitter` constructor (lines 263-270): add `traceId,` to the config object alongside `traceSink` and `recordIO: false`.
   - **Before** writing the `run-start` SSE event, call `traceRegistry.register(traceId, userId)` so the live path is enabled immediately.
   - Update the `run-start` payload (lines 357-360) to include `traceId`:
     ```ts
     await stream.writeSSE({
       event: "run-start",
       data: JSON.stringify({ agentId, kind: manifest.kind, sessionId, traceId }),
     });
     ```
4. **`/run` blocking handler** (lines 175-242): no changes (playground uses `/run/stream`).

### Documentation references

- `packages/worker/src/routes.ts:244-398` (the `/run/stream` handler in full)
- `packages/worker/src/routes.ts:336-347` (the `reply` `writeSSE` pattern — same style for our updated `run-start`)
- `packages/worker/src/routes.ts:357-360` (the existing `run-start` write — exact spot to update)
- `packages/worker/src/routes.ts:763-800` (the `/traces/:id/stream` consumer of `getInProgress`)
- `packages/worker/src/trace-registry.ts:3-13` (interface to extend)
- `packages/worker/src/trace-registry.ts:160-166` (`getInProgress` to relax)
- Phase 1's patched `telemetry.ts:298` (the line that now respects the injected `traceId`)

### Verification checklist

- [ ] `pnpm -F @agntz/worker build` succeeds.
- [ ] `pnpm -F @agntz/worker test` passes — including `trace-registry.test.ts` and `span-emission-e2e.test.ts`.
- [ ] **Add a test** in `packages/worker/src/__tests__/trace-registry.test.ts` (or a new file) covering:
  - `register(t, u)` then `getInProgress(t, u)` returns `[]` not `null`.
  - `register(t, u)` then `spanStart(span_with_traceId=t)` then `getInProgress(t, u)` returns `[span]`.
  - `register(t, u)` then `traceDone(t, u, summary)` then `getInProgress(t, u)` returns `null`.
- [ ] Manual smoke: with the worker running, `curl -N -X POST $WORKER_URL/run/stream -H 'Content-Type: application/json' -H "X-Internal-Secret: $SECRET" -d '{"userId":"u","agentId":"...","input":"hello"}'`. The first SSE frame must be `event: run-start\ndata: {"agentId":"...","kind":"...","sessionId":"...","traceId":"tr_..."}`.

### Anti-pattern guards

- Do not change `traceDone` to return data — it must remain `void` for the interface contract.
- Do not write a snapshot for the trace at `register` time; the snapshot path is for terminal traces with a stored summary.
- Do not have `register()` broadcast a synthetic event — subscribers must only see real `span-start`/`span-end`/`trace-done` events.
- Do not change the `tr_` prefix or the id length without coordinating with telemetry's `ulid()` callers.

---

## Phase 3 — API proxy verification (no code change expected)

**Goal**: Confirm the existing Next route handlers pass through correctly for our new SSE shape.

### What to implement

Likely nothing. The two routes already pipe bytes verbatim:
- `packages/app/src/app/api/run/stream/route.ts` (verified passthrough)
- `packages/app/src/app/api/traces/[id]/stream/route.ts` (verified passthrough)

### Verification checklist

- [ ] `curl -N -X POST http://localhost:3000/api/run/stream -H 'Content-Type: application/json' -b "<session cookie>" -d '{"agentId":"<known agent>","input":"hi"}'` — first frame is `run-start` with `traceId`.
- [ ] Immediately (in a second terminal) `curl -N http://localhost:3000/api/traces/<the traceId>/stream -b "<cookie>"` — receives `span-start` events as they fire.
- [ ] If either of the above 404s or hangs, debug before moving on. **Do not** advance to UI work until this round-trips correctly.

### Anti-pattern guards

- Do not parse the SSE stream in the Next route — it must stay a passthrough so Hono's framing is preserved.
- Do not set `Cache-Control: max-age=...` — `no-cache` only.

---

## Phase 4 — UI: `rightPaneOverride` prop on view components

**Goal**: Allow the parent editor page to inject a custom right pane (the playground) without changing view modes.

### What to implement

1. **`packages/app/src/components/v3/editor/single-agent-view.tsx`** (props at lines 59-81, render at 234-243):
   - Add `rightPaneOverride?: React.ReactNode` to the props object.
   - At the right-pane render site (inside the grid), if `rightPaneOverride` is provided AND `view !== "yaml"` (the only view that hides the right column today), render `rightPaneOverride` instead of `<SingleAgentInspector ... />`. Keep the `InstructionPanel` branch untouched (that's `view === "instruction"`).
2. **`packages/app/src/components/v3/editor/pipeline-view.tsx`** (props at lines 55-74, render at 222-252):
   - Same change as above for `PipelineInspector`.

### Documentation references

- Single-agent-view right-pane render: lines 234-243.
- Pipeline-view right-pane render: lines 222-252.
- Existing `yamlPanel` slot is the precedent for adding a slot prop (single-agent-view passes `yamlPanel` into the middle column; we're mirroring that for the right column).

### Verification checklist

- [ ] `pnpm -F @agntz/app typecheck` succeeds.
- [ ] Open `/agents/<existing single agent id>` — UI is visually identical to before (no override consumer yet).
- [ ] Open `/agents/<existing pipeline id>` — same, no regressions.
- [ ] Grep both view files for `rightPaneOverride` — exactly one render site each.

### Anti-pattern guards

- Do not add a `play` view mode — keep the union as today.
- Do not change the grid `gridTemplateColumns` for the `build` view (the 420px column is fine for our playground; the playground can scroll internally).
- Do not pass the override unconditionally — `view === "yaml"` should still hide the right pane.

---

## Phase 5 — UI: Mode toggle in editor page

**Goal**: Add an Edit/Play toggle and wire the existing Playground button. Right pane shows a stub in play mode; real content lands in Phase 6+.

### What to implement

In `packages/app/src/app/agents/[id]/page.tsx`:

1. Add state: `const [mode, setMode] = useState<"edit" | "play">("edit");`
2. Replace the existing `Playground` `<Btn>` at lines 168-170 with a toggle:
   - When `mode === "edit"`: show "Playground" button. `onClick={() => setMode("play")}`.
   - When `mode === "play"`: show "Edit" button. `onClick={() => setMode("edit")}`.
   - Keep the same `<Btn variant="secondary">` style and `I.Play` icon (use `I.X` or similar for the "Edit/close" icon — verify what's available in `v3/icons`).
3. Pass a stub `rightPaneOverride` to both `SingleAgentView` and `PipelineView` when `mode === "play"`:
   - For now: `<div style={{ padding: 16 }}><Mono color={ag.muted}>Playground (Phase 6)</Mono></div>`
4. Do not change `view` state — manifest editor stays on whatever mode the user had (build/yaml/instruction/both).

### Documentation references

- `packages/app/src/app/agents/[id]/page.tsx:159-172` (secondaryActions area to update)
- `packages/app/src/app/agents/[id]/page.tsx:196-216` (the conditional `PipelineView` / `SingleAgentView` render — where to thread `rightPaneOverride`)
- Phase 4's added prop on each view.

### Verification checklist

- [ ] `pnpm -F @agntz/app typecheck` succeeds.
- [ ] Open an agent page; click "Playground" — right pane shows the stub. Click "Edit" — right pane returns to the inspector.
- [ ] Toggle between `build` / `yaml` / `instruction` / `both` view modes while in play mode — the play override remains on the right (except in `yaml` mode, which has no right pane).
- [ ] Pipeline agent shows the same toggle behavior.

### Anti-pattern guards

- Do not put the mode toggle into the existing `view` switcher — that switcher controls the manifest editor's layout, not the playground.
- Do not change `secondaryActions` to drop the History button.
- Do not auto-collapse the right pane on dirty manifests — saving is handled by Phase 7's Save & Run.

---

## Phase 6 — Playground component: input form (no trace yet)

**Goal**: Replace the Phase 5 stub with a real input form that POSTs to `/api/run/stream` and shows the final output. Trace view lands in Phase 7.

### What to implement

1. **New file** `packages/app/src/components/playground/input-form.tsx`:
   - Props: `{ manifest: Record<string, unknown>; value: unknown; onChange: (next: unknown) => void; }`
   - Read `manifest.inputSchema` (cast via `as Record<string, unknown> | undefined`).
   - If present: render one `EditableText` / `EditableNumber` / `EditableSelect` / `EditableToggle` per declared property (use `manifest/src/types.ts:35-45` to drive the dispatch).
   - If absent: render a single `EditableText` with `multiline rows={6} mono` and label "Input".
   - Above the form, if `manifest.examples` is a non-empty array of `{ input, output }`, render "Use example" chips that set the input to `example.input` on click.

2. **New file** `packages/app/src/components/playground/playground.tsx`:
   - Props: `{ agentId: string; manifest: Record<string, unknown>; dirty: boolean; onSaveAndRun: () => Promise<void>; }`. (Parent provides `onSaveAndRun` so the existing `handleSave` in `agents/[id]/page.tsx` is reused.)
   - Local state: `input` (driven by `InputForm`), `sessionId` (optional, `undefined` = fresh), `sessions: SessionSummary[]` (fetched lazily from `/api/sessions?agentId=...`), `running: boolean`, `runError: string | null`, `runResult: { output: unknown; state: unknown; replies?: Reply[]; sessionId: string } | null`.
   - Layout (top to bottom inside the right pane): `<InputForm>` → "Use example" chips (inside the form) → session selector (`EditableSelect`, default = "New session") → Run button → results panes.
   - Run button label: `dirty ? "Save & Run" : "Run"`. On click: if dirty, `await onSaveAndRun()` first; then POST `/api/run/stream` with `{ agentId, input, sessionId }`.
   - SSE consumption — use the `fetch` + `ReadableStream` reader pattern (since `EventSource` does not support POST). Parse SSE frames manually:
     - `run-start`: store `traceId` (used by Phase 7).
     - `reply`: append to `replies` (display below output).
     - `run-complete`: set `runResult`, mark `running = false`.
     - `run-error`: set `runError`, mark `running = false`.
   - Results panes (re-use trace-detail-page's visual style at lines 186-203): output, state, replies — each as a labeled `<pre>` block.

3. **`packages/app/src/app/agents/[id]/page.tsx`**: replace the Phase 5 stub override with `<Playground agentId={manifestId} manifest={parsed ?? {}} dirty={dirty} onSaveAndRun={handleSave} />`.

### Documentation references

- `packages/manifest/src/types.ts:35-45` (`InputSchema` / `PropertyDef` shape — drives the form dispatch)
- `packages/manifest/src/types.ts:118` (`Example` shape — drives the "Use example" chips)
- `packages/app/src/components/v3/editor/editable-fields.tsx` (form primitives — copy usage from how `single-agent-view.tsx` uses them)
- `packages/app/src/app/api/sessions/route.ts:1-16` (session list — returns `SessionSummary[]`)
- `packages/core/src/types.ts:392-398` (`SessionSummary` fields)
- `packages/worker/src/routes.ts:336-382` (the `reply` and `run-complete` SSE payloads we'll parse)
- `packages/app/src/app/agents/[id]/page.tsx:79-103` (`handleSave` — re-used via the `onSaveAndRun` prop)
- For SSE-via-fetch parsing: write a tiny inline parser that splits on `\n\n` and reads `event: ` / `data: ` lines. Keep it in `playground.tsx`; do not introduce a new dependency.

### Verification checklist

- [ ] `pnpm -F @agntz/app typecheck` succeeds.
- [ ] Run an LLM agent with a declared `inputSchema` (use the agent-builder system agent if needed, or any test agent with declared properties). Form renders labeled fields. Submit produces output.
- [ ] Run an LLM agent with no `inputSchema`. Textarea fallback renders. Submit produces output.
- [ ] Run a pipeline agent. If `inputSchema` is on the root, fields render; if not, textarea fallback. Submit produces output.
- [ ] Save & Run: dirty the manifest, click "Save & Run" — manifest persists then runs. After completion, `dirty` is false (per `handleSave`).
- [ ] Session selector: drop-down lists prior sessions for this agent; selecting one carries the conversation; "New session" starts fresh.
- [ ] If `manifest.examples` is set, "Use example" chips populate the form (string-typed inputs go into the single textarea; structured inputs are a follow-up — `examples` today is a string anyway per manifest/types.ts:118-121).

### Anti-pattern guards

- Do not use `EventSource` for `/api/run/stream` (it's POST-only on the wire — `EventSource` does GET).
- Do not introduce an SSE library. The manual parser is ~30 lines.
- Do not block the UI on the SSE read loop — use an async function with a streaming reader.
- Do not show "Open in Traces →" until Phase 7 wires the `traceId`.
- Do not store the entire span list yet (that's Phase 7).

---

## Phase 7 — Playground component: live trace view

**Goal**: Once `run-start` arrives with the `traceId`, open a parallel `EventSource` on `/api/traces/{traceId}/stream`, accumulate spans into local state, and render `GanttStrip` + `SpanTree` + `SpanDetailPanel`.

### What to implement

1. **New file** `packages/app/src/components/playground/live-trace.tsx`:
   - Props: `{ traceId: string | null; agentId: string; }`
   - Local state: `summary: TraceSummary | null`, `spans: Span[]`, `selectedSpanId: string | null`.
   - When `traceId` becomes non-null, initialize `summary` to a synthetic placeholder (`status: "running"`, `startedAt: new Date().toISOString()`, `spanCount: 0`, `totalTokens: 0`, `totalCostUsd: null`, etc.) and open `new EventSource(\`/api/traces/${encodeURIComponent(traceId)}/stream\`)`.
   - Handlers (mirror `packages/app/src/app/traces/[traceId]/page.tsx:62-100` exactly):
     - `span-start { span }`: append to `spans`; if no `selectedSpanId` yet, set to root.
     - `span-end { spanId, patch }`: merge patch into the matching span.
     - `trace-done { summary }`: replace `summary`, close the EventSource.
   - Render: `<GanttStrip spans summary selectedSpanId onSelect={setSelectedSpanId} />` on top, then a two-column grid `minmax(260px, 360px) 1fr` with `<SpanTree>` + `<SpanDetailPanel>` (clone from trace-detail-page lines 186-203).
   - When `trace-done` fires, render a small "Open in /traces" link: `<Link href={\`/traces/${encodeURIComponent(traceId)}\`}>Open full view →</Link>`.

2. **`packages/app/src/components/playground/playground.tsx`**:
   - After receiving the `run-start` SSE event, store `traceId` in state and render `<LiveTrace traceId={traceId} agentId={agentId} />` below the input form (above the output/replies panes).
   - The output/replies panes from Phase 6 stay — they show the final result. The live trace shows the journey.
   - On a new Run, reset `traceId` to `null` first so `<LiveTrace>` unmounts and remounts cleanly.

### Documentation references

- `packages/app/src/app/traces/[traceId]/page.tsx:58-111` (SSE consumer to mirror)
- `packages/app/src/app/traces/[traceId]/page.tsx:186-203` (gantt + tree + detail layout to clone)
- `packages/app/src/components/traces/gantt-strip.tsx` (props)
- `packages/app/src/components/traces/span-tree.tsx` (props)
- `packages/app/src/components/traces/span-detail-panel.tsx` (props)
- `packages/core/src/types.ts:1031-1043` (`TraceSummary` fields for the synthetic placeholder)
- `packages/core/src/types.ts:1059-1062` (`TraceLiveEvent` discriminator)

### Verification checklist

- [ ] `pnpm -F @agntz/app typecheck` succeeds.
- [ ] Run a multi-step sequential pipeline. Gantt + tree populate live as spans fire (no flicker, no missing spans).
- [ ] Run a parallel pipeline. Sibling spans appear concurrently in the gantt strip.
- [ ] Run an LLM agent with tool calls. `tool` kind spans appear nested under the invoke span.
- [ ] On error during a run, `run-error` fires on `/run/stream`. `live-trace` continues to receive `span-end` with `status: "error"` and `trace-done` from `/traces/:id/stream`. The right pane shows the error state cleanly.
- [ ] After `trace-done`, clicking "Open full view →" lands on `/traces/<traceId>` with the same data.
- [ ] Run twice in a row without leaving the page — second run replaces the trace (no leftover spans from the first).

### Anti-pattern guards

- Do not subscribe to `/traces/:id/stream` before Phase 2 is verified to register the trace — you'll get a 404.
- Do not fetch the trace snapshot first (`GET /api/traces/:id`) — we have an empty trace at run-start and accumulate from there. The trace-detail page fetches the snapshot because it loads pre-existing traces; the playground starts fresh.
- Do not reuse `SpanTree`'s internal expand state across runs — unmount/remount on each new `traceId` resets it naturally.
- Do not show the trace view before `traceId` is set — render nothing or a small "Waiting for run-start…" placeholder while running.

---

## Phase 8 — Tidy up: redirect old playground route

**Goal**: Don't maintain two playground implementations.

### What to implement

Replace `packages/app/src/app/agents/[id]/playground/page.tsx` (the existing stub) with a thin client-side redirect:

```tsx
"use client";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PlaygroundRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/agents/${encodeURIComponent(id)}?mode=play`);
  }, [id, router]);
  return null;
}
```

And in `/agents/[id]/page.tsx`, read the `mode` query param on mount: if it's `"play"`, initialize state to `"play"` instead of `"edit"`.

### Documentation references

- Existing stub: `packages/app/src/app/agents/[id]/playground/page.tsx:1-95` (to be replaced)
- `useSearchParams` from `next/navigation` for the `?mode=play` read.

### Verification checklist

- [ ] Visiting `/agents/<id>/playground` redirects to `/agents/<id>?mode=play` and lands in play mode.
- [ ] Visiting `/agents/<id>?mode=play` directly lands in play mode.
- [ ] Visiting `/agents/<id>` (no query) lands in edit mode.

### Anti-pattern guards

- Do not delete the route — keep the redirect for back-compat with bookmarks.
- Do not push to history — `router.replace` not `router.push`.

---

## Phase 9 — Final verification

**Goal**: Prove the layers compose correctly end-to-end.

### What to verify

- [ ] `pnpm -w typecheck` (or workspace equivalent) — passes.
- [ ] `pnpm -w test` — all package tests pass. Specifically:
  - `packages/core/tests` — including Phase 1's new `traceId` injection (write a smoke test if absent).
  - `packages/worker/src/__tests__/trace-registry.test.ts` — including Phase 2's new `register()` + relaxed `getInProgress`.
  - `packages/worker/src/__tests__/span-emission-e2e.test.ts` — verify the `tr_` prefix and injected id propagate.
- [ ] `grep -rn "source.*playground\|playground.*source" packages/core packages/worker` — should return nothing (we deliberately did NOT add this).
- [ ] `grep -rn "rightPaneOverride" packages/app/src/components/v3` — exactly two definitions (single-agent-view, pipeline-view) and one consumer (`agents/[id]/page.tsx`).
- [ ] Manual end-to-end:
  - Run a single LLM agent → trace shows one root, one invoke span, output renders.
  - Run a sequential pipeline → trace shows root, step children, child invoke + tool spans render in order.
  - Run a parallel pipeline → siblings appear concurrently in the gantt strip.
  - Dirty the manifest then click Save & Run → save persists, run executes the new version.
  - Visit `/agents/<id>/playground` → redirects to `/agents/<id>?mode=play`.
- [ ] No console errors during a run.
- [ ] No leaked `EventSource` connections (DevTools → Network → EventStream — count drops to zero after `trace-done`).

### Final cross-check against locked decisions

- [ ] **Layout**: Editor + Play toggle ✓ (Phase 5)
- [ ] **Draft handling**: Save & Run when dirty ✓ (Phase 6)
- [ ] **Input form**: Schema-driven + textarea fallback + examples + session selector ✓ (Phase 6)
- [ ] **Trace rendering**: Reuses `GanttStrip` / `SpanTree` / `SpanDetailPanel` ✓ (Phase 7)
- [ ] **Run history**: Latest run only ✓ (no history strip)
- [ ] **Persistence**: Playground runs land in /traces undifferentiated ✓ (no source tag added)
- [ ] **Streaming architecture**: Two-stream — `/run/stream` with `run-start { traceId }`, then `/traces/:id/stream` ✓ (Phases 2, 6, 7)
- [ ] **Pipelines**: Single + sequential + parallel all work ✓ (no runtime changes needed)

---

## Out of scope (deliberately deferred)

- Adding a `source: "playground" | "production"` tag to `TraceSummary`, `TraceFilter`, and TraceStore impls.
- Making `inputSchema` mandatory on pipeline roots (breaking change; needs its own decision).
- Run history strip in the playground panel.
- A-B comparison of past runs.
- Eval scoring inputs.
- Dedicated `/agents/[id]/playground` rich layout (we redirect to the in-editor play mode instead).

## File inventory (final)

**Modified**
- `packages/core/src/telemetry.ts` (Phase 1: ~2 lines)
- `packages/worker/src/trace-registry.ts` (Phase 2: ~15-25 lines incl. tests)
- `packages/worker/src/routes.ts` (Phase 2: ~4 lines)
- `packages/app/src/components/v3/editor/single-agent-view.tsx` (Phase 4: ~3 lines)
- `packages/app/src/components/v3/editor/pipeline-view.tsx` (Phase 4: ~3 lines)
- `packages/app/src/app/agents/[id]/page.tsx` (Phases 5, 6, 8: ~30 lines)
- `packages/app/src/app/agents/[id]/playground/page.tsx` (Phase 8: replace contents with redirect)

**New**
- `packages/app/src/components/playground/input-form.tsx` (Phase 6)
- `packages/app/src/components/playground/playground.tsx` (Phase 6/7)
- `packages/app/src/components/playground/live-trace.tsx` (Phase 7)
- `packages/worker/src/__tests__/trace-registry.test.ts` additions (Phase 2)
