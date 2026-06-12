# The Worker

The **worker** (`packages/worker`, published as `@agntz/worker`) is a stateless Hono HTTP service that owns all agent execution in the hosted agntz stack. The App proxies to it. External API clients hit it directly. It is the only place where the core agent loop runs in production.

> If you're using the core SDK (`agntz`) standalone in your own service, you don't need the worker — `createRunner()` runs the loop in-process. The worker is for the multi-tenant hosted setup where (a) execution needs its own service for scaling, and (b) authentication and per-user scoping have to be enforced at a network boundary.

## The boundary

```
┌──────────────────────────────────────────────────────────────┐
│           Next.js App (packages/app)                          │
│           - UI                                                │
│           - /api routes call the worker                       │
│           - never touches the agent loop                      │
└──────────────────────────────┬───────────────────────────────┘
                               │  POST /run | /runs | /traces | …
                               │  X-Internal-Secret + userId
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                  Worker (Hono, this chapter)                  │
│                                                              │
│   workerAuth → resolves userId                                │
│   resolveRunnerAndManifest → per-request Runner               │
│   execute(manifest, input, ctx)  ← @agntz/manifest             │
│           │                                                  │
│           └─► runner.invoke()  ← @agntz/core                   │
│                  • agent loop                                │
│                  • tool registry                             │
│                  • MCP clients                               │
│                  • span emission → trace registry             │
└──────────────────────────────────────────────────────────────┘
                               │
                               ▼
                       UnifiedStore (Postgres in prod)
```

A fresh `Runner` is built **per request**. The store is the only thing shared across requests — and it's auto-scoped to the inbound user via `store.forUser(userId)`.

## The route surface

Every route lives in `packages/worker/src/routes.ts:84-505`:

### Public

| Method + Path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness probe — returns `{ status: "ok", service: "agntz-worker" }` |

### Synchronous execution

| Method + Path | Auth | Purpose |
|---|---|---|
| `POST /run` | `workerAuth` | One-shot invoke. Returns `{ output, state }` when the loop terminates |
| `POST /run/stream` | `workerAuth` | One-shot invoke with SSE. Emits `run-start`, `run-complete`/`run-error` |

### Tracked Runs

| Method + Path | Auth | Purpose |
|---|---|---|
| `POST /runs` | `workerAuth` | Start a tracked Run. Returns the Run record + `Location` header |
| `GET /runs` | `workerAuth` | List user's Runs with filters and cursor pagination |
| `GET /runs/:id` | `workerAuth` | Fetch one Run's current state |
| `GET /runs/:id/stream` | `workerAuth` | SSE multiplexed events. Supports `?since=N` for resume |
| `POST /runs/:id/cancel` | `workerAuth` | Cancel a Run and cascade to descendants |

See [the Runs chapter](/guide/08-runs) for the data model.

### Traces

| Method + Path | Auth | Purpose |
|---|---|---|
| `GET /traces` | `workerAuth` | List user's `TraceSummary` with filters |
| `GET /traces/:id` | `workerAuth` | Fetch one trace — returns `{ summary, spans }` |
| `GET /traces/:id/stream` | `workerAuth` | SSE live trace events (or one-shot snapshot if completed) |
| `DELETE /traces/:id` | `workerAuth` | Delete a trace and its spans |

See [the Traces chapter](/guide/09-traces) for the data model.

### Validation

| Method + Path | Auth | Purpose |
|---|---|---|
| `POST /validate` | `workerAuth` | Validate a YAML manifest. Optional `strict: true` performs MCP reachability checks |

### System agents

| Method + Path | Auth | Purpose |
|---|---|---|
| `GET /system/agents` | `internalOnlyAuth` | List bundled system agents (e.g., the agent-builder) |
| `GET /system/agents/:id` | `internalOnlyAuth` | Get YAML + parsed manifest for one system agent |

System agents are loaded from YAML files bundled inside `packages/worker/src/defaults/` at build time. They're not user-scoped — they ship with the worker.

## Two auth modes

The `workerAuth` middleware (`packages/worker/src/middleware/auth.ts:23-54`) accepts either:

### Internal — app → worker

```http
POST /runs HTTP/1.1
X-Internal-Secret: <WORKER_INTERNAL_SECRET>
Content-Type: application/json

{ "agentId": "support", "userId": "user_abc", "input": "…" }
```

`X-User-Id` header is also accepted as a fallback when the body has no `userId`. Used by the Next.js App's `/api` routes which have already verified the user's Clerk session and just need to assert "this request is from us, and it's for user X."

### External — third-party API caller

```http
POST /runs HTTP/1.1
Authorization: Bearer ar_live_abcdef…
Content-Type: application/json

{ "agentId": "support", "input": "…" }
```

The key is hashed and looked up via `ApiKeyStore.resolveApiKey(rawKey)`. The resolved userId is then used to scope the store.

Both modes terminate in the same `c.set("userId", ...)` call — the route handlers don't care which auth mode the request used. See [the auth chapter](/guide/19-auth) for the full picture.

## Per-request lifecycle

```typescript
// packages/worker/src/routes.ts:149-195 (POST /run)
app.post("/run", async (c) => {
  const userId = getUserId(c);                           // from workerAuth
  const { agentId, input } = await c.req.json();

  const { runner, manifest } = await resolveRunnerAndManifest(
    store,
    userId,
    agentId,
  );
  // resolveRunnerAndManifest:
  //   • scoped = store.forUser(userId)
  //   • load agent YAML from system-agents bundle OR from scoped store
  //   • parseManifest(yaml)
  //   • createRunner({ store: scoped, tools: LOCAL_TOOLS })

  const runRegistry = new InMemoryRunRegistry();
  const spanEmitter = new SpanEmitter({ traceSink: …, recordIO: false });
  const ctx = createExecutionContext(runner, {
    runRegistry,
    spanEmitter,
    ownerId: userId,
  });

  const result = await execute(manifest, input ?? "", ctx);
  return c.json({ output: result.output, state: result.state });
});
```

Key invariants:

- **`Runner` is per-request.** No shared agent loop state across requests.
- **`store` is process-wide** but every access goes through `forUser(userId)`. Row-level filtering means user A literally cannot read user B's data.
- **`InMemoryRunRegistry` is per-request for the one-shot `/run` endpoint** — that endpoint doesn't expose run handles. The `/runs/*` endpoints use the **process-wide** `runRegistry` (`packages/worker/src/routes.ts:66-80`) so handles outlive the request.
- **`SpanEmitter` is per-request** and routes events to the process-wide `traceRegistry`.

## Local tools

The worker bundles a small set of local tools (`packages/worker/src/tools/registry.ts` → `LOCAL_TOOLS`) — agents that reference these by name (e.g., `{ type: "inline", name: "read_file" }`) get them without any user-side registration. Notable bundled tool:

- `read_file` (`packages/worker/src/tools/read-file.ts`) — reads bundled reference files for the `agent-builder` system agent. Guarded against path traversal.

User-defined tools today live in YAML/manifest form. Runtime-registered local tools (via `runner.registerTool()`) aren't currently exposed to the worker over HTTP — they'd require a server-side function registry, which is out of scope for the multi-tenant deployment.

## Process-wide singletons

Two registries live at the worker level, not the request level (`packages/worker/src/routes.ts:60-80`):

- **`InMemoryTraceRegistry`** — receives spans from every request's `SpanEmitter`, batches writes to `TraceStore`, and multiplexes live events to `/traces/:id/stream` subscribers.
- **`InMemoryRunRegistry`** (for `/runs/*`) — holds live Run trees, AbortController hierarchies, replay buffers. `persistRun` callback routes durable writes to `store.forUser(run.userId).putRun(...)`.

These survive request-to-request. A `GET /runs/:id/stream` reconnecting after a network blip will find the still-running Run in the registry and pick up at the requested `seq`.

## Configuration

The worker reads three env vars at boot (see [deployment chapter](/guide/20-deployment) for the full env contract):

| Env var | What |
|---|---|
| `WORKER_INTERNAL_SECRET` | Shared secret for App → Worker auth |
| `STORE` | `memory` (default, for dev) or `postgres` |
| `DATABASE_URL` | Required when `STORE=postgres` |
| `MEMREZ_STORE` | `postgres`, `memory`, or `disabled`; defaults to `STORE` |
| `MEMREZ_DATABASE_URL` | Optional separate Postgres URL for memrez memory |
| `MEMREZ_TABLE_PREFIX` | Optional prefix for memrez tables |

Provider API keys for OpenAI/Anthropic/etc. are **per-user**, stored in `ProviderStore` and resolved at runtime via `AISDKModelProvider`. The worker doesn't need them as env vars — though it falls back to env (`OPENAI_API_KEY`, etc.) if a user has no `ProviderConfig` registered.

## Running locally

```bash
pnpm --filter @agntz/worker dev    # :4001
```

`packages/worker/src/server.ts` wires `createWorkerAPI()` to a Node Hono server. The App proxies to it over `WORKER_URL=http://localhost:4001`.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/worker/src/routes.ts` | All HTTP routes |
| `packages/worker/src/middleware/auth.ts` | `workerAuth`, `internalOnlyAuth`, `getUserId`, `getCachedBody` |
| `packages/worker/src/bridge.ts` | `createExecutionContext` — manifest ↔ runner bridge |
| `packages/worker/src/store.ts` | Store backend selection from env |
| `packages/worker/src/system-agents.ts` | Bundled system agent loader |
| `packages/worker/src/tools/registry.ts` | `LOCAL_TOOLS` — worker-bundled inline tools |
| `packages/worker/src/trace-registry.ts` | `InMemoryTraceRegistry` |
| `packages/worker/src/session-redact.ts` | Skill instruction redaction in session history |
| `packages/worker/src/validation.ts` | `buildValidationContext` for `/validate` |
| `packages/worker/src/server.ts` | Node entrypoint |
