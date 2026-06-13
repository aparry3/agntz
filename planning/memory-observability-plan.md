# Memory Observability & Preload for memrez + agntz

**Status:** Implemented (M1–M4, 2026-06-12) · **Date:** 2026-06-12 · **Companion to:** [`data-encryption-plan.md`](./data-encryption-plan.md)

> **Implementation notes (2026-06-12).** All four phases landed. Resolutions of §5's open questions:
> 1. Pinned topic name: **`pinned`** (documented in the built-in reasoner instructions + memrez README).
> 2. `preloadLimit` default: **50 entries**; cap is entry-count only, with an explicit "+N more not shown" note to the model on overflow.
> 3. Enumeration shape: **`listDirtyTopics()`** on `MemoryStore` (all three stores), driven by `topic_meta.last_updated_at` watermarks; `curate()` now stamps every scanned `(scope, topic)` pair after a curate-capable pass, which also makes `scan()`'s `hasUncuratedWrites` real instead of hardcoded `true`.
> 4. Pagination: **endpoint-layer `limit`/`offset`** (default 200, max 1000) with `total` in the response; `Memrez.list()` stays unpaginated.
> 5. Grants transport: **comma-separated/repeatable `grants` query param** for GETs, `grants` body field for POSTs; multiple grants allowed.
>
> Beyond the plan: the app's `/memory` viewer and `/api/memory/*` proxy routes are **super-admin-gated** (same gate as System Agents) because grants are taken verbatim — they open to all users only after the tenant-prefixing decision (encryption plan §5/§12). The hosted cron is an in-process `MEMREZ_CURATE_INTERVAL` sweep in `server.ts` sharing `runCurationSweep()` with `POST /memory/curate`.
>
> **Reasoner correction (post-review).** The plan's D6 framed importance/tagging as partly the *writing agent's* job (topicsHint at write time, "day-one solution with the deterministic reasoner"). That blends agent logic into memory logic. Corrected: **memrez owns organization; the agent's `memory_write` is content-only** (no `type`/`topicsHint` in the tool schema — programmatic `WriteOptions.topicsHint` is retained for trusted callers/tests). The **built-in `llmReasoner()` is now the `createMemrez()` default and the only supported reasoner loop** — direct model calls through core's `AISDKModelProvider`, no agntz client/runner, so memrez stays strictly below the agent layer and there's no client↔resource circular construction. The `pinned` set is maintained by the reasoner (tagger files it, curator promotes/demotes), not by agent prompt guidance. Missing provider key → throws on first write (loud setup error); transient model failure → deterministic fallback so the write still lands. `DeterministicReasoner` is tests + the `MEMREZ_REASONER=deterministic` kill-switch. The agntz-agent-loop reasoner is punted until we have explicit guardrails; the worker just calls `createMemrez({ store })` like every other consumer.

agntz has traces for agent observability but nothing equivalent for memory: once memrez writes an entry, there is no way to see it outside the agent loop. This plan adds (a) a deterministic read surface — SDK methods, worker endpoints, app viewer — so a user's memories can be inspected for a grant exactly as an agent would see them, (b) invoke-time preloading of important memories so agents don't burn a turn recalling obvious context, and (c) the wiring that makes curation actually run, which both of the above quietly depend on.

---

## 1. Current state (verified findings)

- **`Memrez.scan/read/write/curate` are already public deterministic methods** taking `grants: string[]` (`packages/memrez/src/memrez.ts`). The library viewing path exists today; nothing new is needed to call it from an embedding backend.
- **Agents get `read` + `write` tools only; scan is not a tool.** The provider's `getContext` hook (`provider.ts:27`) injects a topic list — name, count, blurb — into every run, controlled by `autoScan` (default ON). Invoke-time topic injection already exists.
- **`read` is single-topic.** Tool schema is `topic: z.string()`; `Memrez.read` takes one topic. An agent recalling three topics pays three round trips.
- **`curate` previously never ran anywhere.** The old default `DeterministicReasoner` implemented only `tag`, so `Memrez.curate` fell back to zero ops when `reasoner.curate` was undefined. The corrected default is the built-in `llmReasoner()`, which implements both `tag` and `curate` as direct structured model calls owned by memrez.
- **The "read everything" primitive already exists at the store level:** `MemoryStore.listScopeSlice(scopePaths, { topics?, includeSuperseded? })` — curate itself uses it. A public wrapper is ~10 lines.
- **Topics are tags, not paths.** Postgres schema: `entries` has a single `scope TEXT` column (hierarchy is string convention; `visibleScopes` expands grants and queries `scope = ANY(...)`); `entry_topics` is an `(entry_id, topic)` join table — many flat labels per entry; `topic_meta` is keyed `(scope, topic)` and holds blurbs. Topics are per-scope and orthogonal to the scope hierarchy.
- **No scope enumeration on `MemoryStore`.** Every method takes `scopePaths` as input. A global curation cron has no way to discover which scopes have work. `TopicSummary.hasUncuratedWrites` exists per topic but is only reachable if you already know the scope.

## 2. Design decisions

**D1 — The viewer uses the agent's own authorization path.** Viewing takes grants and expands them through the same `normalizeGrants → visibleScopes` pipeline agents use. "View exactly what the agent sees" is then true by construction, and there is one authz model, not two. Nomenclature: *grants* are what a caller holds; *scopes* are what they expand to; entries live at exactly one scope.

**D2 — One new read method: `Memrez.list()`.**

```ts
async list(
  grants: NamespaceGrant[],
  opts: { topics?: string[]; includeSuperseded?: boolean } = {},
): Promise<MemoryEntry[]>
```

A thin wrapper over `listScopeSlice` (normalize grants → visible scopes → slice). Named `list` for consistency with `listTopics`/`listScopeSlice`, not `readAll`. `includeSuperseded: true` is the audit view — supersession chains are how you debug "memrez got it wrong." The viewer composes `scan()` (topics) + `list()` (entries); preload-all (D5) reuses the same method.

**D3 — Multi-topic `read`.** Tool input becomes `topics: string[]` (accepting a single string for compatibility); implementation loops `getByTopic` per topic to keep the per-topic limit semantics. Saves a round trip per topic on every recall.

**D4 — Correction is supersede, not UPDATE.** (Later phase; decided now so the viewer is built for it.)

```ts
async correct(grants, id, newContent): Promise<{ entry: MemoryEntry }>
// = put new entry inheriting old topics/type/scope, then store.supersede([id], newId)
```

Deterministic — no tagger call, topics are inherited. Zero new store methods. Preserves the audit trail the viewer exposes. In-place editing would fight dedup, curation, and the encryption plan's append-mostly assumptions.

**D5 — Preload config on the memory resource.**

```yaml
resources:
  memory:
    config:
      autoScan: true            # topic list + blurbs (existing behavior, unchanged)
      preload: all              # or a topic list: [pinned] / [goals, equipment, schedule]
      preloadLimit: 50          # entry cap across preloaded topics
```

`getContext` inlines full entries for the selected topics beneath the topic list. `all` mode is for small scopes: active entries only, sorted `updatedAt` desc, **`type: event` excluded by default** (events accumulate linearly — every logged workout — and would crowd out durable facts), capped at `preloadLimit`. The long-term fix for event bloat is curation superseding old events into `summary` entries, at which point `all` stays naturally small.

**D6 — Importance is a conventional topic tag (`pinned`), not schema.** "Save equipment access to the `equipment` topic AND the always-load set" is one entry dual-tagged `["equipment", "pinned"]` — one entry row, two join rows. No duplication, no sync problem (a duplicated entry would let a correction strand a stale twin). The general-case preload config is `preload: [pinned]`. Three writers maintain the set, all already plumbed:

1. *Agent author at write time* — the write tool's `topicsHint`; prompt guidance like "include `pinned` for durable profile facts (equipment, schedule, goals)." Works with the deterministic reasoner; day-one solution.
2. *Tagger organically* — the LLM tagger sees `existingTopics` and gravitates to an established `pinned` topic.
3. *Curator at curation time* — `CurateOp.supersede` already carries `replacement.topics`, so the curator can promote entries into and demote them out of the pinned set with zero schema change. Long-term this is the right owner: only the curator sees the whole scope.

Side benefit: `pinned` appears in scan like any topic, so its per-`(scope, topic)` blurb is the user's one-line profile ("3×/week, dumbbells only, goal: strength") — agents without preload still get that line via autoScan.

*Rejected:* importance-by-scope-position (scope encodes ownership/visibility, not importance; in a flat-scope app it degenerates to `all` anyway) and a `pinned: boolean` schema field (touches entry schema, store methods, tagger output, curate ops — the topic convention gets ~95% for zero migration; promote to a field later if load-bearing).

**D7 — Curation wiring.**

- *Local:* use the default `createMemrez({ store })` LLM reasoner and call `await memrez.curate(grants)` — from a script, on session end, or write-triggered (after N writes to a topic with `hasUncuratedWrites`).
- *Hosted:* a cron hits an internal `POST /memory/curate`. Requires closing the enumeration gap with a new store method, e.g. `listDirtyTopics(): Promise<{ scope: string; topic: string }[]>` (driven by the existing uncurated-writes tracking), so the cron pages through dirty topics and curates each with `grants = [scope]`. That per-scope loop has a nice property under the encryption plan: curate only ever needs one scope's DEK unwrapped at a time.
- The worker must not route memrez reasoning back through the agntz agent loop for now. The default LLM reasoner keeps tagging/curation below the agent layer and avoids circular memory-tool construction.

**D8 — Worker read endpoints.** `GET /memory/topics?grants=…` and `GET /memory/entries?grants=…&topics=…&includeSuperseded=…` on the process-wide memrez instance from `resources.ts`, behind the existing internal-secret auth, calling `scan()`/`list()`. This un-parks the "hosted memory read endpoints" item from the encryption plan §12. The tenant-prefixed key-root precondition from that plan's §5 applies identically here: the route layer must resolve the effective scope as `{tenantId}/{scope}` before these endpoints ship to multi-tenant traffic. Scoped end-user tokens (grant-bound, capability-bound, short-lived) remain parked; v1 is app→worker internal auth only.

## 3. Compatibility with the encryption plan

Everything here sits **above** the store interface, and the encryption decorator sits **at** it — so `list()`, preload, correction, and curation all read/write plaintext through the decorated store with no awareness of ciphertext. Two touch points: (1) D8's endpoints inherit the tenant-prefix precondition; (2) `listDirtyTopics` (D7) returns scope/topic names only, which stay plaintext under the encryption plan's §7 field table. No changes to either plan's phasing are required by the other.

## 4. Rollout phases

| Phase | Scope | Packages |
|-------|-------|----------|
| **M1** | `Memrez.list()`, multi-topic `read` tool, `preload` + `preloadLimit` in `getContext`, `pinned` convention documented in reasoner guidance | `memrez` |
| **M2** | Worker read endpoints (`GET /memory/topics`, `GET /memory/entries`), app memory viewer (topics → entries → audit view) | `worker`, `app` |
| **M3** | Curation wiring: built-in LLM reasoner default, `listDirtyTopics` store method, `POST /memory/curate` + cron | `memrez`, `worker` |
| **M4** | Correction: `Memrez.correct()`, edit affordance in the viewer | `memrez`, `worker`, `app` |

M1 is pure library work — deterministic, no store schema changes, shippable independently of the encryption plan's P1. M2 should land after (or with) the tenant-prefixing decision (encryption plan open question 6). M3 is what makes blurbs/pinned/summaries real; until it lands, preload via explicit topics or `all` carries the weight.

## 5. Open questions

1. **Pinned topic name** — `pinned`, `core`, or `profile`? Leaning `pinned` (describes the behavior, reads naturally in scan output).
2. **`preloadLimit` default** — 50 entries? Should the cap also be expressible in characters/tokens?
3. **Enumeration shape for curation** — `listDirtyTopics()` vs a generic `listScopes(prefix?)` plus per-scope `listTopics`? Dirty-topics is narrower and cheaper; generic enumeration may be wanted by the viewer later anyway (an operator console listing all scopes needs it).
4. **Endpoint pagination** — `listScopeSlice` has no limit/offset; fine for the SDK, but the worker endpoints should probably page from day one. Add `limit`/`cursor` to the endpoint layer or push pagination into `list()`?
5. **Grants transport for D8** — query params vs header vs the run-style `context` body field; and whether the viewer should accept multiple grants or exactly one scope per request (singular is simpler to audit).
