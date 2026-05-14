# The HTTP SDK Client

`@agntz/sdk` is the TypeScript HTTP client for the agntz Worker API. It is **separate** from `agntz` (the core SDK that runs the agent loop in-process) — use `@agntz/sdk` when you want to call a hosted worker from your application, in either Node or the browser.

```
agntz                    @agntz/sdk
─────                    ──────────
in-process runner        HTTP client
your app embeds          your app calls a remote worker
ai-sdk → model           fetch → POST /runs → worker runs loop → SSE
```

If you're hosting your own agents, you generally pick one. If you're using the agntz hosted product, you only ever use `@agntz/sdk`.

## Install

```bash
npm install @agntz/sdk
```

## Create a client

```typescript
import { AgntzClient } from "@agntz/sdk";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,        // ar_live_…
  baseUrl: "https://worker.agntz.co",
  // fetch?: typeof fetch                     // optional override (universal)
  // defaultSignal?: AbortSignal              // optional shutdown signal
});
```

`apiKey` and `baseUrl` are required. The client is universal — it works in Node 18+ and in modern browsers without modification (`packages/sdk/src/client.ts:32-42`).

## Three resources

```typescript
client.agents   // AgentsResource — synchronous /run, /run/stream
client.runs     // RunsResource — tracked /runs/*
client.traces   // TracesResource — /traces/*
```

### One-shot invocation

```typescript
const result = await client.agents.run({
  agentId: "greeter",
  input: "Say hi to Aaron",
});
console.log(result.output);
```

Streaming variant:

```typescript
for await (const event of client.agents.stream({ agentId: "greeter", input: "…" })) {
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "complete") break;
}
```

### Tracked runs

```typescript
const run = await client.runs.start({
  agentId: "researcher",
  input: "MCP best practices",
  sessionId: "sess_abc",
});

// Watch live events, with resume support
let lastSeq: number | undefined;
for await (const event of client.runs.stream({ runId: run.id, since: lastSeq })) {
  lastSeq = (event as { seq?: number }).seq ?? lastSeq;
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "run-complete") console.log("\n", event.result.output);
}

// Or poll
const current = await client.runs.get(run.id);

// List with filters + cursor pagination
const { rows, cursor } = await client.runs.list({
  rootsOnly: true,
  status: "completed",
  limit: 50,
});

// Cancel
await client.runs.cancel(run.id);
```

### Traces

```typescript
// List
const { rows } = await client.traces.list({ limit: 25 });

// Fetch
const { summary, spans } = await client.traces.get(traceId);

// Subscribe live
for await (const event of client.traces.stream(traceId)) {
  if (event.type === "span-start") console.log("→", event.span.name);
  if (event.type === "span-end")   console.log("✓", event.spanId);
  if (event.type === "trace-done") break;
}

await client.traces.delete(traceId);
```

## Streaming and SSE

All `.stream()` methods are async generators that yield typed events. Internally they:

1. `POST` or `GET` with `Accept: text/event-stream`.
2. Parse SSE frames with the package's own parser (`packages/sdk/src/sse.ts`) — no `EventSource` dependency, so it works in Node identically to the browser.
3. Normalize the JSON payload into the appropriate event union (`packages/sdk/src/events.ts`).
4. Close cleanly on terminal events (`run-complete`, `run-error`, `run-cancelled`, `trace-done`, `snapshot`).

If the connection drops mid-stream and `since` was passed for runs, the worker resumes at the next `seq` — no replays, no gaps.

## Cancellation with AbortSignal

Every method accepts an optional `signal`:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

const run = await client.runs.start({
  agentId: "slow-agent",
  input: "…",
  signal: controller.signal,    // cancels the HTTP request
});
```

Note: an `AbortSignal` only cancels the HTTP request — to cancel the Run itself on the server, call `client.runs.cancel(runId)`.

You can also pass `defaultSignal` to the client constructor — every request composes the per-call signal with the client-level one, so a single `defaultSignal.abort()` shuts down everything in flight.

## Errors

```typescript
import {
  AgntzError,
  AuthenticationError,
  NotFoundError,
  StreamError,
} from "@agntz/sdk";

try {
  await client.runs.get("nonexistent");
} catch (err) {
  if (err instanceof NotFoundError) { /* 404 */ }
  if (err instanceof AuthenticationError) { /* 401 */ }
  if (err instanceof StreamError) { /* SSE-specific */ }
  if (err instanceof AgntzError) { /* catch-all */ }
}
```

`StreamError` carries a `code` like `STREAM_TRUNCATED` when the stream closed before a terminal event (`packages/sdk/src/client.ts:343-346`).

## Types

The SDK re-exports the shared event/run/span types as a type-only public surface (`packages/sdk/src/index.ts:9-31`):

```typescript
import type {
  AgentKind,
  Run,
  RunStatus,
  Span,
  SpanKind,
  SpanStatus,
  StreamEvent,
  TraceDetail,
  TraceFilter,
  TraceLiveEvent,
  TraceSummary,
  MultiplexedRunEvent,
} from "@agntz/sdk";
```

These mirror the core types but are hand-maintained inside the SDK so the package has zero runtime dependency on `@agntz/core` — it's pure HTTP and SSE.

## When to use `@agntz/sdk` vs `agntz`

| You want… | Use |
|---|---|
| To embed agents in your own Node service, manage your own DB | `agntz` |
| To call agents hosted by the agntz worker from your app | `@agntz/sdk` |
| To run agents in the browser | `@agntz/sdk` (the core SDK is Node-only) |
| To build admin tooling that talks to the worker | `@agntz/sdk` |

Both packages emit the same conceptual events — `text-delta`, `tool-call-start`, etc. — so logic that consumes them is portable between the two surfaces.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/sdk/src/index.ts` | Public exports |
| `packages/sdk/src/client.ts` | `AgntzClient`, `AgentsResource`, `RunsResource`, `TracesResource` |
| `packages/sdk/src/fetch.ts` | `sendRequest`, `composeSignal` |
| `packages/sdk/src/sse.ts` | `parseSSE` — universal SSE parser |
| `packages/sdk/src/events.ts` | Event normalizers |
| `packages/sdk/src/errors.ts` | `AgntzError`, `AuthenticationError`, `NotFoundError`, `StreamError` |
| `packages/sdk/src/types.ts` | Hand-mirrored shared types |
