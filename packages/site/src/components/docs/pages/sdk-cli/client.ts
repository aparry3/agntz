export default `# @agntz/client

The hosted client. Calls agents on \`agntz.co\` or your self-hosted worker over HTTPS. Universal — runs in Node, the browser, edge runtimes, and Workers.

\`\`\`bash
pnpm add @agntz/client
\`\`\`

Same API surface as [@agntz/sdk](/docs/sdk-cli/sdk) — code is portable between embedded and hosted modes.

## Basic usage

\`\`\`ts
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,    // ar_live_...
  baseUrl: "https://api.agntz.co",       // or your self-hosted worker URL
});

// Non-streaming
const { output, state } = await client.agents.run({
  agentId: "support-agent",
  input: { message: email.body, customerId: email.from },
});

// Streaming with cancellation
const controller = new AbortController();
for await (const event of client.agents.stream({
  agentId: "support-agent",
  input: { message: "Hello" },
  signal: controller.signal,
})) {
  if (event.type === "complete") console.log("output", event.output);
  if (event.type === "error") console.error(event.error);
}

// Runs lifecycle
const run = await client.runs.start({ agentId: "support-agent", input: { /* ... */ } });
const fresh = await client.runs.get(run.id);
await client.runs.cancel(run.id);   // cascades to all descendants

// Traces
const traces = await client.traces.list({ status: "error", limit: 20 });
const detail = await client.traces.get(traces.rows[0].id);
\`\`\`

## Constructor options

\`\`\`ts
new AgntzClient({
  apiKey: "ar_live_...",
  baseUrl?: "https://api.agntz.co",     // default
  fetch?: typeof fetch,                  // override (e.g. for testing)
  defaultHeaders?: Record<string, string>,
});
\`\`\`

## API surface

### \`client.agents.run({ agentId, input, sessionId? })\`

Run an agent to completion. Returns \`{ output, state, runId, sessionId, replies }\`.

### \`client.agents.stream({ agentId, input, sessionId?, signal? })\`

Async iterator over SSE stream events. Always yields a terminal event (\`complete\` or \`error\`). Pass an \`AbortSignal\` to cancel mid-stream — the underlying request is aborted and the run is cancelled server-side.

### \`client.runs.*\`

\`\`\`ts
const { rows, nextCursor } = await client.runs.list({
  agentId,
  status,        // "running" | "complete" | "error" | "cancelled"
  limit,
  cursor,
});

const run = await client.runs.get(runId);
await client.runs.cancel(runId);                  // cascades

// Start a run without awaiting completion — useful for long-running workflows
const handle = await client.runs.start({ agentId, input });
// later
const final = await client.runs.get(handle.id);

// Multiplexed event stream for a run subtree (parent + descendants)
for await (const ev of client.runs.stream({ runId: handle.id })) { /* ... */ }
\`\`\`

### \`client.traces.*\`

\`\`\`ts
const trace = await client.traces.get(runId);
const list = await client.traces.list({ status: "error" });
await client.traces.delete(traceId);

// Live spans as a run executes
for await (const ev of client.traces.stream(runId)) {
  if (ev.type === "span-end") console.log(ev.span.name, ev.span.durationMs);
}
\`\`\`

## Sessions

Pass the same \`sessionId\` across calls to continue a conversation. The hosted runtime auto-loads and appends history.

\`\`\`ts
await client.agents.run({ agentId: "support", input: "Hi",       sessionId: "user-42" });
await client.agents.run({ agentId: "support", input: "follow-up", sessionId: "user-42" });
\`\`\`

Sessions are managed automatically and scoped to your user. See [Sessions](/docs/concepts/sessions).

## Errors

\`\`\`ts
import { AgntzError, AuthenticationError, NotFoundError, RateLimitError, StreamError } from "@agntz/client";

try {
  await client.agents.run({ agentId: "unknown", input: {} });
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — unknown agent id
  }
  if (err instanceof AuthenticationError) {
    // 401 — invalid or revoked API key
  }
  if (err instanceof RateLimitError) {
    // 429 — back off; err.retryAfter is the suggested delay (seconds)
  }
  if (err instanceof StreamError) {
    // SSE protocol failure
  }
}
\`\`\`

All errors extend \`AgntzError\`. The embedded runner re-exports the same types so error-handling code is portable.

## Authentication

Two modes are accepted by the worker:

- **External clients** — \`Authorization: Bearer ar_live_...\` (this is what \`@agntz/client\` sends). Keys are issued in **Settings → API Keys** on \`agntz.co\` or your self-hosted UI.
- **Internal callers** (the app calling the worker) — \`X-Internal-Secret\` + \`userId\` in the body. See [HTTP API reference](/docs/deploy/http-api#authentication).

For browser usage, **never embed an \`ar_live_*\` key client-side**. Proxy through your own backend and inject the key server-side.

## Self-host with the same client

The hosted client works against any agntz worker — the public \`api.agntz.co\` or your own deployment. Just point \`baseUrl\` at your worker URL and use an API key you minted there.

\`\`\`ts
const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://agntz-worker.mycompany.com",
});
\`\`\`
`;
