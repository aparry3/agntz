# @agntz/memrez

Durable tagged memory for agntz agents.

memrez stores facts, preferences, events, and summaries under namespace scopes. It plugs into agntz through the generic resource provider system, so agents get memory tools such as `memory_read` and `memory_write` while application code keeps control of runtime namespace grants.

memrez owns memory organization, not the calling agent. The agent's `memory_write` takes **content only** — choosing the scope, topics, and entry type, normalizing the text, and detecting duplicates are all the reasoner's job. By default that reasoner is a built-in LLM (`llmReasoner()`), so memory handling is genuinely offloaded: the agent says *what* to remember, memrez decides *how* it's filed.

## Install

```bash
pnpm add @agntz/memrez
```

The default reasoner makes direct model calls and reads its API key from the provider env var (e.g. `OPENAI_API_KEY`). A missing key throws on the first write; set one, or pass your own `reasoner`.

## Use with the embedded SDK

Declare memory in an LLM agent:

```yaml
id: support-with-memory
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: |
  Help the user. Use memory when it is relevant.
resources:
  memory:
    mode: read-write
    autoScan: true
```

Wire the provider and pass trusted runtime grants:

```ts
import { agntz } from "@agntz/sdk";
import { createMemrez, SqliteMemoryStore } from "@agntz/memrez";

const memrez = createMemrez({
  store: new SqliteMemoryStore("./memory.db"),
});

const client = await agntz({
  agents: "./agents",
  resources: { memory: memrez.provider() },
});

await client.agents.run({
  agentId: "support-with-memory",
  input: "Remember that I prefer metric units.",
  context: ["app/user/" + userId],
});
```

`context` is a namespace grant array for resources. It is different from legacy `contextIds` scratchpad buckets.

## Direct API

```ts
const grants = ["app/user/" + userId];

await memrez.write(grants, "Prefers metric units.", {
  topicsHint: ["preferences"],
});

const entries = await memrez.read(grants, "preferences", { limit: 10 });
const multi = await memrez.read(grants, ["preferences", "goals"]); // one call, deduped
const topics = await memrez.scan(grants);

// Deterministic full read — the viewer/audit primitive. Pass
// includeSuperseded to see supersession chains.
const everything = await memrez.list(grants);
const auditTrail = await memrez.list(grants, { includeSuperseded: true });

// Correct an entry: the replacement inherits scope/topics/type and the
// original is superseded (never edited in place), preserving the audit trail.
const { entry } = await memrez.correct(grants, staleEntryId, "Has dumbbells and a bench.");
```

Direct calls use the same grant validation as resource tool calls.

## Stores

```ts
import {
  createMemrez,
  InMemoryMemoryStore,
  PostgresMemoryStore,
  SqliteMemoryStore,
} from "@agntz/memrez";

createMemrez({ store: new InMemoryMemoryStore() });
createMemrez({ store: new SqliteMemoryStore("./memory.db") });
createMemrez({ store: new PostgresMemoryStore(process.env.DATABASE_URL!) });
```

Use in-memory storage for tests, SQLite for local or single-node deployments, and Postgres for multi-process deployments.

## Resource behavior

- `autoScan` injects visible memory topic summaries into the model context before tool calls.
- `preload` inlines full entries at invoke time so agents don't burn a turn recalling obvious context. Either `all` (every active entry, `event` entries excluded) or an explicit topic list.
- `preloadLimit` caps the preloaded entries (default 50); overflow is noted to the model.
- `memory_read` accepts one topic or a list of topics in a single call.
- `mode: read` exposes read tools only.
- `mode: read-write` exposes read and write tools.
- The memory provider validates writes against runtime grants and `writePolicy`.
- The model never receives a namespace parameter.

```yaml
resources:
  memory:
    kind: memory
    mode: read-write
    autoScan: true
    preload: [pinned]   # or `all` for small scopes
    preloadLimit: 50
```

## The reasoner

The reasoner is how memrez organizes memory. It has two jobs:

- **tag** — runs on every `write`: pick the namespace from the grants, assign topics (reusing existing ones), classify the entry type, normalize the content, flag duplicates.
- **curate** — runs on every `curate`: merge duplicates, reconcile contradictions, compact stale events into summaries, maintain topic blurbs.

`createMemrez({ store })` uses `llmReasoner()` for both — direct model calls, no agntz client or runner involved, so memrez stays strictly below the agent layer (an agent's `memory_write` can never re-enter the agent platform). Override it only when you need different reasoner models or the explicit deterministic kill switch:

```ts
import {
  createMemrez,
  llmReasoner,
  DeterministicReasoner,
} from "@agntz/memrez";

// Default — built-in LLM reasoner, keyed from env. Customize the models:
createMemrez({ store, reasoner: llmReasoner({ taggerModel: { provider: "anthropic", name: "claude-haiku-4-5" } }) });

// Kill-switch / tests — no LLM. Files content under `general`; curate is a no-op:
createMemrez({ store, reasoner: new DeterministicReasoner() });
```

The agntz-agent-loop reasoner is deliberately not supported yet. Tagging and
curation are bounded structured model calls owned by memrez; keeping them out
of the agent loop avoids circular setups where an agent writes memory, memrez
runs an agent, and that agent can see memory tools again.

## The `pinned` topic

Importance is a topic convention the reasoner maintains, not schema. The
built-in tagger files durable profile facts (equipment, schedule, goals, hard
constraints) under `pinned` alongside their subject topic — one entry, two
topic rows — which you then preload with `preload: [pinned]`. The curator
promotes and demotes entries by rewriting replacement topics during curation,
and the per-scope `pinned` blurb serves as a one-line profile in `autoScan`
output. No schema change, no agent involvement — the writing agent just passes
content.

## Curation

`memrez.curate(grants)` reconciles a scope through the reasoner's `curate`
step (the `DeterministicReasoner` has none, so it's a no-op there). The store
tracks which `(scope, topic)` pairs have writes newer than their last curation
pass: `store.listDirtyTopics()` enumerates them globally (the work-discovery
primitive for curation crons), and `scan()` surfaces the per-topic
`hasUncuratedWrites` flag. The hosted worker wires this up as
`POST /memory/curate` plus an optional `MEMREZ_CURATE_INTERVAL` sweep.

See the public docs for the full guide: `/docs/tools/memory-memrez`.
