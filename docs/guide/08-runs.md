# Runs

A **Run** is a tracked agent invocation. It has an id, a place in a tree (root or child), a lifecycle (`pending → running → draining → completed/failed/cancelled`), and a replay buffer of every event it emitted. Runs are independent of HTTP request lifetime — a client can disconnect, reconnect, and resume streaming from where it left off.

If you've only used `runner.invoke()` from the SDK, you've been making "one-shot" calls that complete before the HTTP response closes. Runs are the durable, observable counterpart — and they're what the App's `/runs` UI, the `@agntz/client` `RunsResource`, and concurrent sub-agent spawning are all built on.

## Run vs Session vs Context

These three concepts get conflated. Lead with the distinction:

| Concept | What it tracks | Scope | Persisted as |
|---|---|---|---|
| **Session** | A conversation thread — `Message[]` between user and agent | One agent, multi-turn | `SessionStore` |
| **Context** | A shared scratchpad agents read from / write to | Many agents, named bucket | `ContextStore` |
| **Run** | A single agent invocation — its inputs, outputs, status, events | One invocation, possibly with child invocations | `RunStore` |

A single `POST /runs` call creates one Run. If that agent spawns three children, you get four Runs total — one root + three children — connected via `parentId`. The whole subtree shares the same `rootId` and the same multiplexed event stream.

## The Run record

```typescript
// packages/core/src/types.ts:542-560
interface Run {
  id: string;
  rootId: string;
  parentId?: string;
  agentId: string;
  userId?: string;
  sessionId?: string;
  spawnToolUseId?: string;
  status: RunStatus;
  input: string;
  result?: InvokeResult;
  error?: string;
  startedAt: number;
  endedAt?: number;
  /** Depth in the Run tree (root = 0) */
  depth: number;
}

type RunStatus = "pending" | "running" | "draining" | "completed" | "failed" | "cancelled";
```

`draining` is the interesting transition: a Run enters it when its own loop finished but it has outstanding spawned children. The run stays in `draining` until those children settle, then flips to `completed`. Cancellation cascades — `cancel(rootId)` aborts every descendant via shared `AbortSignal`s.

## Lifecycle

```
   POST /runs { agentId, input, sessionId? }
              │
              ▼
   runRegistry.create(opts)  → Run { id, status: "pending", depth: 0 }
              │
              ▼
   runRegistry.start(run, executor)
              │
              │   executor runs in the background (fire-and-forget)
              │   registry stamps:  pending → running
              │
              ▼
   model loop emits:  text-delta, tool-call-start, tool-call-end, step-complete
                      → registry.emit(rootId, event) → stream subscribers
              │
              ├──► (if agent has `spawnable`) spawn_agent creates child Runs
              │    each child runs concurrently; results queued for next parent turn
              │
              ▼
   loop terminates
              │
              │   if no pending children → status = "completed"
              │   else → status = "draining" → drain() waits → "completed"
              │
              ▼
   stream emits:  run-complete { result }  → subscribers close
   RunStore.putRun(run)  → durable record
```

## The RunRegistry

The `RunRegistry` (`packages/core/src/types.ts:613-660`) is the in-process source of truth for live Runs. It owns:

- The `AbortController` tree (cancellation cascades down it)
- Per-rootId multiplexed event streams with monotonic `seq` cursors
- The `PendingChildResult` queue (completions waiting to be delivered to a parent's next turn)
- Optional persistence via `RunStore`

```typescript
interface RunRegistry {
  create(opts: SpawnRunOptions): Run;
  start(run: Run, executor: (signal: AbortSignal) => Promise<InvokeResult>): void;
  get(runId: string): Run | undefined;
  children(parentRunId: string): Run[];
  cancel(runId: string, reason?: string): void;
  consumePending(parentRunId: string): PendingChildResult[];
  outstandingChildrenCount(parentRunId: string): number;
  drain(parentRunId: string, signal?: AbortSignal): Promise<void>;
  subscribe(rootId: string, sinceSeq?: number): AsyncIterable<MultiplexedEvent>;
  emit(rootId: string, event: MultiplexedEvent): void;
  notifyCompleted(runId: string, result: InvokeResult): void;
  notifyFailed(runId: string, err: unknown): void;
}
```

The worker constructs **one process-wide** `InMemoryRunRegistry` in `packages/worker/src/routes.ts:66-80` — all users share the same registry, but `userId` on each Run scopes who can see what. Routes filter by `run.userId === requestUserId` before exposing any data.

## Multiplexed events

Subscribing to a Run gives you a stream of every event from the whole subtree, each tagged with its `runId` and a monotonic `seq`:

```typescript
// packages/core/src/types.ts:585-594
type MultiplexedEvent =
  | { type: "run-spawn";       runId: string; parentId?: string; agentId: string; seq: number }
  | { type: "text-delta";      runId: string; text: string;                        seq: number }
  | { type: "tool-call-start"; runId: string; toolCall: { id, name };              seq: number }
  | { type: "tool-call-end";   runId: string; toolCall: ToolCallRecord;            seq: number }
  | { type: "step-complete";   runId: string; step: number; toolCalls;             seq: number }
  | { type: "draining";        runId: string; pendingChildren: string[];           seq: number }
  | { type: "run-complete";    runId: string; result: InvokeResult;                seq: number }
  | { type: "run-error";       runId: string; error: string;                       seq: number }
  | { type: "run-cancelled";   runId: string;                                      seq: number };
```

`seq` is per-rootId and monotonic. A reconnecting client passes `?since=N` to resume at the next event — no replays, no gaps.

## The HTTP surface

The worker exposes `/runs/*` under `packages/worker/src/routes.ts:248-439`:

| Method + Path | Purpose |
|---|---|
| `POST /runs` | Start a tracked Run. Returns the Run record immediately with `Location: /runs/:id` |
| `GET /runs` | List Runs for the current user with filters: `rootsOnly`, `agentId`, `status`, `startedAfter`, `startedBefore`, `limit`, `cursor` |
| `GET /runs/:id` | Fetch the current state of a Run |
| `GET /runs/:id/stream` | SSE stream of multiplexed events. Supports `?since=N` for resume. If the Run was evicted from memory, returns a one-shot `snapshot` event |
| `POST /runs/:id/cancel` | Cancel the Run and cascade to descendants |

Note `POST /run` (no `s`) is the one-shot, synchronous endpoint that pre-dates Runs — it doesn't register with the registry and returns the final output directly. New code should prefer `POST /runs` for anything you want to observe or cancel.

## The SDK surface

`@agntz/client`'s `RunsResource` mirrors the HTTP surface (`packages/sdk/src/client.ts:103-187`):

```typescript
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: "ar_live_…",
  baseUrl: "https://worker.agntz.co",
});

// Start a run — returns immediately
const run = await client.runs.start({
  agentId: "researcher",
  input: "Find recent papers on MCP",
  sessionId: "sess_abc",
});
console.log(run.id, run.status);  // "running"

// Stream events with reconnect support
for await (const event of client.runs.stream({ runId: run.id })) {
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "run-complete") console.log("\n", event.result.output);
}

// Fetch current state
const current = await client.runs.get(run.id);

// Cancel
await client.runs.cancel(run.id);

// List with cursor pagination
const { rows, cursor } = await client.runs.list({ rootsOnly: true, limit: 50 });
```

## RunStore — durable persistence

`RunRegistry` works in-memory only by default. Wire a `RunStore` (`packages/core/src/types.ts:691-702`) to persist Run records past the process lifetime:

```typescript
interface RunStore {
  putRun(run: Run): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  listChildren(parentRunId: string): Promise<Run[]>;
  listSubtree(rootId: string): Promise<Run[]>;
  listRuns(filters: RunListFilters): Promise<RunListResult>;
}
```

`PostgresStore` and the in-memory store both implement it. `UnifiedStore` includes `RunStore`, so `store.forUser(userId).putRun(...)` is the typical write path. The worker wires this in `routes.ts:70-79`:

```typescript
new InMemoryRunRegistry({
  persistRun: async (run) => {
    if (!run.userId) return;
    await store.forUser(run.userId).putRun(run);
  },
});
```

Runs are persisted on every status transition. Terminal Runs (`completed`, `failed`, `cancelled`) stay in memory for a grace period (default 5 minutes) so reconnecting clients can still hit the live event buffer; after that they're evicted and `GET /runs/:id/stream` returns a snapshot from the store.

## Concurrent sub-agents

The `spawn_agent` synthetic tool (registered when an agent declares `spawnable: AgentRef[]`) uses the registry to create child Runs:

```typescript
defineAgent({
  id: "orchestrator",
  spawnable: [
    { kind: "ref", agentId: "researcher" },
    { kind: "ref", agentId: "summarizer" },
  ],
  // …
});
```

The LLM calls `spawn_agent({ agent_id: "researcher", input: "..." })` and gets back a `RunHandle` immediately:

```typescript
{ run_id: "run_xyz", agent_id: "researcher", status: "running" }
```

The child runs concurrently. Its result is queued via `PendingChildResult` and delivered to the orchestrator's next turn — the orchestrator can poll via `check_agents`, but it can't finish until its children settle (or it cancels them).

Limits (`packages/core/src/tools/spawn-agent.ts:14-27`):
- `maxConcurrentChildren = 8`
- `maxDepth = 5` (root is 0)
- `maxDescendants = 50` per subtree

See [agent chains](/guide/agent-chains) for the full pattern.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/core/src/types.ts:530-702` | `Run`, `RunStatus`, `RunRegistry`, `MultiplexedEvent`, `RunStore`, `RunListFilters` |
| `packages/core/src/run-registry.ts` | `InMemoryRunRegistry` implementation |
| `packages/core/src/tools/spawn-agent.ts` | `spawn_agent` + `check_agents` synthetic tools |
| `packages/worker/src/routes.ts:248-439` | `/runs/*` HTTP routes |
| `packages/sdk/src/client.ts:103-187` | `RunsResource` SDK |
