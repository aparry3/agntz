# Memory (`memrez`)

**Status:** Proposed
**Author:** Aaron + Claude
**Date:** 2026-05-24

## Problem

agntz can run agents, but it has no long-term memory. The closest primitives — `SessionStore` (verbatim conversation history) and `ContextStore` (named `contextId` scratch buckets) — are short-term and uncurated. There's no way for an agent to accumulate durable, deduped, queryable knowledge about a user / org / project across sessions.

`memrez` is that layer: individual facts, tagged with topics, partitioned by a hierarchical scope, curated over time. It is a standalone package that *uses* agntz (its tagging/curation brain is an agntz agent) but agntz does not depend on it.

Design tenets:

- Memory is **many small entries + tags**, not one Markdown blob per topic.
- The agent **navigates** memory: a cheap `scan` gives it a table of contents; it `read`s only the topics it needs.
- **Writes are cheap; curation is where the thinking happens.** A fast model tags on write; a stronger model dedupes/reconciles in the background.
- **Tags-first.** Deterministic `scan`→`read` over topics now; embeddings/semantic search later as an optional, additive strategy.
- **One brain, two runtimes.** The tagger/curator are agntz YAML manifests — identical behavior in the TS and Python SDKs, the same way agntz already keeps parity.

## Decisions snapshot

| Choice | Decision |
|---|---|
| Positioning | Standalone package; depends on the agntz SDK to run its memory agent. `memrez → agntz`, never the reverse. |
| Repo | Starts in the agntz monorepo (workspace-linked SDK, reuse `contracts/`). Kept logically standalone for later extraction. |
| Unit of memory | One `MemoryEntry` = one canonical fact + topics + a single owning scope. |
| Scope | Hierarchical path **and access boundary** (`org/acme/user/u_123`). Reads inherit ancestors (shared knowledge flows down); siblings stay isolated. |
| Scope authority | The **granted prefix** is minted at the trust boundary from verified identity and is immutable; the model may only refine *downward* within it. Path shape is app-defined via a scope resolver. |
| Topics | LLM proposes on write (nudged by existing in-scope topics); `curate` normalizes the canonical set. |
| `scan` | Deterministic. Returns the scope's topic TOC (name + live count + curate-maintained blurb). Bootstraps context. |
| `read`/`write` | agntz `kind: local` tools. Scope injected from `toolContext`; LLM picks the topic (read) / supplies the fact (write). |
| `write` path | Cheap-model tag now (assign topics, light dedup), append. Heavy reconciliation deferred to `curate`. |
| `write` input | Caller passes a finished fact; memrez tags + light-normalizes. (Transcript→facts extraction is out of scope for v1.) |
| `curate` | Cron/background. **Append-only + supersede** — never hard-deletes. Merges dupes, reconciles contradictions, refreshes blurbs. |
| Reasoning seam | `Tagger`/`Curator` are injectable; the default impl runs the `memrez-tagger` / `memrez-curator` agntz manifests via the SDK. |
| Search | Tags-only for v1. Embeddings (pgvector / sqlite-vec) are a later, additive strategy. |
| Parity | `contracts/memrez/` fixtures run by both runtimes, using a **deterministic fake reasoner** so LLM nondeterminism doesn't leak into contract tests. |

## Architecture

```
   calling agent (agntz)
        │
        │  (1) scan(scope) ── deterministic ──► topic TOC injected into context
        │  (2) reads a topic on demand        (3) writes a fact
        ▼                                          ▼
   memory_read tool                          memory_write tool      ◄── kind: local tools
        │                                          │                     scope from toolContext
        └──────────────┬───────────────────────────┘
                       ▼
                 memrez core   (scope resolution · scan/read/write/curate · dedup)
                   │                          │
        ┌──────────┘                          └────────────┐
        ▼                                                    ▼
   MemoryStore (in-memory | sqlite | …)             Tagger / Curator  (injectable)
   entries · topic_meta · supersede                     │  default impl
                                                         ▼
                                              agntz SDK ► memrez-tagger.yaml   (cheap model)
                                              agntz SDK ► memrez-curator.yaml  (stronger model)
                                                         │
                                                         ▼
                                              ModelProvider  (AI SDK in TS · LiteLLM in Python)

   curate(scope)  ◄── cron / deterministic call ── runs the curator over a scope subtree
```

## Concepts / data model

```ts
type Scope = string; // hierarchical path: "global" | "org/acme" | "org/acme/user/u_123" | ".../session/s_abc"

interface MemoryEntry {
  id: string;                 // mem_<nanoid>
  scope: Scope;               // single owning scope
  content: string;            // one canonical fact ("Prefers metric units.")
  topics: string[];           // semantic tags within the scope
  type: "fact" | "preference" | "event" | "summary";
  source?: { agentId?: string; sessionId?: string; runId?: string };
  status: "active" | "superseded";
  supersededBy?: string;      // id of the entry that replaced this one
  createdAt: string;
  updatedAt: string;
  // embedding?: number[];    // Phase 6
}

interface TopicSummary {
  topic: string;
  count: number;               // live count of active entries
  blurb?: string;              // curate-maintained one-liner
  lastUpdatedAt: string;
  hasUncuratedWrites: boolean; // writes since the last curate
}
```

**Scope resolution.** `read`/`scan` over `org/acme/user/u_123` see entries at that path *and* every ancestor prefix (`org/acme`, `global`), so org-wide and global facts surface for a user without being copied. Each entry owns exactly one scope; moving a fact up a level (session→user) is a `curate` operation, not multi-membership.

## Public API

```ts
import { createMemrez } from "memrez";

const memrez = createMemrez({
  store: sqliteStore("./memory.db"),       // default: in-memory
  reasoner: agntzReasoner({ client }),      // default impl wraps the agntz SDK + the two manifests
});

// Deterministic API — also what the tools and the cron job call:
const toc     = await memrez.scan("org/acme/user/u_123");
const entries = await memrez.read("org/acme/user/u_123", "billing", { limit: 20 });
const result  = await memrez.write("org/acme/user/u_123", "Prefers email over phone.", {
  source: { sessionId, agentId },
});
const report  = await memrez.curate("org/acme/user/u_123");
```

Signatures:

```ts
scan(scope, opts?: { includeAncestors?: boolean; topicLimit?: number })
  : Promise<{ scope: Scope; topics: TopicSummary[] }>;

read(scope, topic, opts?: { limit?: number; includeAncestors?: boolean })
  : Promise<MemoryEntry[]>;

write(scope, content, opts?: { type?: EntryType; topicsHint?: string[]; source?: Source })
  : Promise<{ entry: MemoryEntry; action: "appended" | "superseded" | "deduped" }>;

curate(scope, opts?: { topics?: string[]; includeDescendants?: boolean })
  : Promise<CurateReport>;
```

## Using it from an agntz agent

`read`/`write` are exposed as local tools. `memrez.tools()` returns an array of self-describing `ToolDefinition`s (each carries its own `name`), which you spread into the runner's `tools` array. **Scope is read from `toolContext`, never chosen by the model** — an agent can't reach another user's memory by hallucinating a scope. The LLM only picks the topic (read) or supplies the fact (write).

```ts
const mem = createMemrez(options);
const memoryTools = mem.tools(); // ToolDefinition[] → registers memory_read, memory_write

const client = await agntz({
  agents: "./agents",
  tools: [...memoryTools, ...appTools], // spread into the tools array
});
```

```yaml
# agents/support.yaml
tools:
  - kind: local
    tools: [memory_read, memory_write]
```

`scan` runs *before* the model call and its TOC is prepended to the agent's input (a `memrez.contextBlock(scope)` helper returns the string). The agent sees *what* it knows and calls `memory_read` only for the topics it actually needs.

> **Embedded-SDK caveat.** Per-run scope reaches the tools via `toolContext`. The core `createRunner().invoke(input, { toolContext })` accepts it today (see the gymtext example), but `@agntz/sdk`'s `agents.run(...)` does **not** thread `toolContext` yet — so the SDK path either drops to the core Runner or needs a small `toolContext` passthrough added. Tracked in open questions.

## Scope as a capability

A scope is not just where a memory is filed — it is the **access boundary**. The isolation model is one rule:

> The **granted prefix** is minted at the trust boundary from *verified identity* and is immutable for the request. The model can only **refine downward** within it — never widen, never jump sideways.

So scope has two halves: a **granted prefix** from auth (the API route, or a hosted workspace API key) that the model never controls, and an optional **relative refinement** supplied by the agent and joined under the prefix server-side — which can only narrow.

```
effective_scope = granted_prefix + (optional refinement, clamped inside the prefix)
```

This is the discipline agntz already uses for `ctx.user.id`: the route loads identity and injects it via `toolContext`; the LLM chooses *what* to do, not *whose* data. A scope path is `<tenancy…>/<subject>` — leading segments are the namespace (app / workspace / org), the trailing segment is the subject (user / account). The exact shape is **app-defined via a scope resolver**, since only the app knows its tenancy model.

**Inheritance goes up; isolation is sideways.** A read at a scope includes its *ancestors* (broader, shared knowledge flows down) but never its *siblings*. That single rule delivers sharing and isolation together.

### Example — gymtext (app → user)

```
gymtext                       ← trainer-wide memory (add later — costs nothing now)
└─ user/
   ├─ u_123   ← travel prefs, equipment access, goals, injuries
   └─ u_456   ← isolated: u_123's agent can never read this (sibling, not an ancestor)
```

```ts
// scope minted HERE, from the authenticated user — the trust boundary
const scope = `gymtext/user/${userId}`;
const toc = await memrez.contextBlock(scope);    // scan TOC as a string

const result = await runner.invoke("chat", `${toc}\n\n${message}`, {
  sessionId,
  toolContext: { user, memrezScope: scope },      // memory_read/write bind to this scope
});
```

`memory_read` / `memory_write` read `ctx.memrezScope`; the model picks a topic but the scope is fixed, so `u_123` and `u_456` can never see each other. Add trainer-wide memory later by writing at `gymtext` — every user's read inherits it, with no per-user duplication and no schema change. That free shared layer is why scope is a path, not a flat id.

### Example — sales platform (app → org → account)

```
sales
└─ org/
   ├─ acme                    ← org heuristics: "if property A is true, also find B"
   │  └─ account/
   │     ├─ a_789  ← "usually omits property A; assume X, then confirm"
   │     └─ a_790
   └─ globex                  ← different org: fully isolated from acme
```

The lead agent for `a_789` is granted `sales/org/acme/account/a_789`; its reads inherit `sales/org/acme` (the org's qualification rules) but globex is invisible. **Promotion** is the curator's job: running at `sales/org/acme` (granted the org subtree) it notices the same pattern across sibling accounts — "most omit property A" — and writes a generalized heuristic *up* at the org scope, where every account agent inherits it. Account quirks stay low; learned generalizations rise.

## Running memrez: local vs hosted

Two independent axes — how an agent gets memory, and where memrez itself runs.

**Integration surface — how an agent gets memory:**

| Surface | For |
|---|---|
| `memrez.tools()` → `ToolDefinition[]`, spread into the runner's `tools: [...]` (registers `memory_read`, `memory_write`) | agntz agents — the easy path |
| The same handlers wrapped as plain function-calling tools | non-agntz agents (raw Anthropic tool-use, LangChain, …) |
| Direct `memrez.scan/read/write/curate` calls | the app injects memory itself, no tools exposed |

The consumer-facing surface is **framework-neutral**; the only agntz coupling is the reasoner (tagger / curator), and that is swappable. A non-agntz caller can use the tools and inject its own tagger, or let memrez run a headless agntz internally as its brain.

**Topology — where storage + reasoner live:**

| | Embedded / local | Hosted memrez service |
|---|---|---|
| Runs | in-process in your app | separate multi-tenant service |
| Store | sqlite / your DB | service-managed (Postgres, later pgvector) |
| Who mints the prefix | your route, from your auth | the service, from the API key → workspace |
| Enforcement | you trust your own process | server-side; the caller's key *is* its prefix capability |
| Reasoner + curate cron | your SDK + your keys | service runs them per scope (BYO-key optional) |

**The scope model is identical in both** — what changes is who is trusted to mint the prefix and where it is enforced. Path shape, inheritance, and isolation never change. gymtext (one app, its own DB) is naturally embedded; a multi-org sales SaaS is the case for hosted, because one process then holds many tenants' memories.

> **The background curator is scope-bound too.** A hosted deployment runs the curator as a scheduled per-scope job; the curator for `org/acme` is granted only the acme subtree and can never read another tenant. Every memrez operation — foreground tool call or background curate — runs inside a scope grant. A curator that could read across scopes would be a cross-tenant leak.

## Reasoning layer (the shared brain)

Two agntz manifests, loaded by both runtimes from one canonical location (`packages/memrez/agents/`):

- **`memrez-tagger`** (cheap model). In: `{ content, scope, existingTopics, topicsHint? }`. Out: `{ topics, type, normalizedContent, duplicateOf? }`. Drives `write`.
- **`memrez-curator`** (stronger model). In: a scope's entry slice + the topic set. Out: `{ ops: CurateOp[] }` — `merge`, `supersede`, `retag`, `setBlurb`, `promoteScope`. Drives `curate`.

memrez-core only knows the `Tagger`/`Curator` interfaces. `agntzReasoner()` is the default implementation that runs these manifests through `client.agents.run(...)`; the per-language `ModelProvider` (AI SDK / LiteLLM) makes the actual LLM call. Swap in a custom reasoner and memrez has no agntz dependency at all.

## Storage

`MemoryStore` is memrez's own small interface (mirrors how agntz ships `MemoryStore`/`SQLiteStore`):

```
putEntry · getEntry · supersede(ids, byId)
listTopics(scopePaths) → TopicSummary[]            // aggregates topic + count + blurb
getByTopic(scopePaths, topic, limit) → entries
getTopicMeta / setTopicMeta(scope, topic, blurb, lastCuratedAt)
listScopeSlice(scope, opts) → entries              // for curate
```

Tables: `entries`, `topic_meta` (scope, topic, blurb, lastCuratedAt). v1 adapters: in-memory + sqlite. Postgres + a `vector` column arrive with the embeddings phase.

**scan TOC tuning (recommendation).** Return *all* topic names + live counts (cheap even at hundreds of topics) plus curate-maintained blurbs; if topics exceed a cap, send blurbs only for the most-recently-touched K (names+counts for the rest). `hasUncuratedWrites` flags drift since the last curate. v1 is query-agnostic (the full map); query-aware ranking waits for embeddings.

## Parity / contracts

Add `contracts/memrez/` mirroring `contracts/python-port/`: scenario fixtures (a sequence of writes → expected topic assignment, supersede graph, scan TOC shape, scope-ancestor resolution). Both runtimes test against them.

Crucial: contract tests use a **deterministic fake reasoner** (fixed content→topics mapping). That pins the parts that must match across languages — storage, scope resolution, dedup, supersede, scan aggregation — without asserting on nondeterministic LLM output. Real tagger/curator quality is covered separately by agntz **evals** on the two manifests.

## Implementation phases

**Phase 1 — memrez-core (TS), no LLM.** Types, `MemoryStore` + in-memory adapter, scope/ancestor resolution, scan/read/write/curate orchestration against injectable `Tagger`/`Curator`. Tests with a fake reasoner.

**Phase 2 — agntz reasoner + manifests.** `memrez-tagger.yaml` / `memrez-curator.yaml`; `agntzReasoner()` wiring `write`→tagger, `curate`→curator via the SDK. Evals on both manifests.

**Phase 3 — agntz tool surface.** `memory_read`/`memory_write` as `kind: local` tools (scope from `toolContext`); `scan` + `contextBlock` injection helper. One end-to-end example agent.

**Phase 4 — sqlite adapter.** Persistence across restarts; `topic_meta` table.

**Phase 5 — Python port.** Mirror core + adapters; load the *same* manifests via the Python agntz SDK; wire `contracts/memrez/` into both test suites. Parity lock.

**Phase 6 (later) — embeddings.** `vector` column (sqlite-vec / pgvector), embed on write + re-embed on curate, hybrid retrieval (topic filter + vector rank), query-aware `scan`.

## Open questions

1. **Auto-injection vs app-driven.** v1 has the app call `scan` and prepend the TOC. Should the agntz runner eventually grow a memory hook that scans/writes automatically (RAG-style), or stay explicit? (Leaning explicit — matches the agentic-tools decision.)
2. **write dedup depth.** How hard does the cheap tagger try to detect "already known" / supersede vs. always append and let `curate` clean up? Lean: append + exact-dup skip only; curate does the rest.
3. **Promotion trigger.** session→user, or cross-sibling→parent (the sales "most accounts omit A" case). Curator-driven is the primary path; do we also expose an explicit `promote()` API? Lean: curator-driven, explicit API as an escape hatch.
4. **Blurb storage.** `topic_meta` table vs a `type:"summary"` entry per topic. Lean: `topic_meta`.
5. **Package name.** Bare `memrez` (honors standalone) vs `@agntz/memrez` (monorepo consistency). Doc assumes bare `memrez`.
6. **Manifest location across languages.** Canonical YAML in `packages/memrez/agents/`; does Python read those files directly or get a packaged copy at build?
7. **Embedded-SDK `toolContext` passthrough (agntz dependency).** The core Runner's `invoke(..., { toolContext })` binds scope today, but `@agntz/sdk`'s `agents.run()` doesn't expose `toolContext` yet — memrez tools need per-run scope. Resolution: use the core Runner for memory-bound agents, or add `toolContext` to the SDK run options (small agntz-side change).

## Out of scope (v1)

- Embeddings / semantic search (Phase 6).
- Extracting facts from raw transcripts (the caller's job for now).
- Multi-scope-per-entry membership.
- A hosted memrez service or UI.
- Cross-tenant / global curate runs (`curate` operates on one scope subtree).
