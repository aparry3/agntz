# @agntz/sdk

Official TypeScript client for the agntz HTTP API. Universal — runs in Node 20+ and modern browsers. Zero runtime dependencies.

## Install

```bash
pnpm add @agntz/sdk
```

## Usage

```ts
import { AgntzClient } from "@agntz/sdk";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: process.env.AGNTZ_WORKER_URL!,
});

// Non-streaming
const { output, state } = await client.agents.run({
  agentId: "my-agent",
  input: { hello: "world" },
});

// Streaming
const controller = new AbortController();
for await (const event of client.agents.stream({
  agentId: "my-agent",
  input: { hello: "world" },
  signal: controller.signal,
})) {
  if (event.type === "start") console.log("started", event.kind);
  if (event.type === "complete") console.log("output", event.output);
  if (event.type === "error") console.error(event.error);
}

// Health check
await client.health();
```

## Auth

The SDK authenticates with a Bearer API key (`ar_live_...`). Generate one from the agntz app UI.

## Errors

- `AgntzError` — base class; all SDK errors inherit from it.
- `AuthenticationError` — 401 responses (invalid or revoked key).
- `NotFoundError` — 404 responses (e.g., unknown agent id).
- `StreamError` — SSE protocol failures or streams that close before a terminal frame.

## Cancellation

Pass an `AbortSignal` via `signal` on any call, or `defaultSignal` on the client. `break` from a `for await` loop also cleans up the underlying stream.
