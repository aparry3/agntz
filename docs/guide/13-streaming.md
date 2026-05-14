# Streaming

`runner.stream(agentId, input, options?)` returns an async iterable of typed `StreamEvent`s alongside a `result` promise. Use it when you want partial output as the model generates — typically to feed a live UI.

## Basic streaming

```typescript
const stream = runner.stream("writer", "Write a short story about a robot");

for await (const event of stream) {
  if (event.type === "text-delta") {
    process.stdout.write(event.text);
  } else if (event.type === "done") {
    console.log("\n\nFinal output:", event.result.output);
    console.log("Tokens:", event.result.usage.totalTokens);
  }
}
```

Or skip the iterator and await the final result directly:

```typescript
const stream = runner.stream("writer", "…");
const result = await stream.result;
```

## Event types

`StreamEvent` is a discriminated union (`packages/core/src/types.ts:187-192`):

| Event | Payload | When |
|---|---|---|
| `text-delta` | `{ text: string }` | Incremental text chunk from the model |
| `tool-call-start` | `{ toolCall: { id, name } }` | A tool invocation is starting |
| `tool-call-end` | `{ toolCall: ToolCallRecord }` | A tool invocation completed, with result and duration |
| `step-complete` | `{ step: number; toolCalls: ToolCallRecord[] }` | One iteration of the agent loop finished |
| `done` | `{ result: InvokeResult }` | Final result with full output, usage, all tool calls |

The exhaustive union:

```typescript
type StreamEvent =
  | { type: "text-delta";       text: string }
  | { type: "tool-call-start";  toolCall: { id: string; name: string } }
  | { type: "tool-call-end";    toolCall: ToolCallRecord }
  | { type: "step-complete";    step: number; toolCalls: ToolCallRecord[] }
  | { type: "done";             result: InvokeResult };
```

`done` is always the last event. Once you see it, the iterator closes.

## Streaming with tool calls

The stream surfaces tool execution as it happens:

```typescript
for await (const event of stream) {
  switch (event.type) {
    case "text-delta":
      process.stdout.write(event.text);
      break;
    case "tool-call-start":
      console.log(`\n→ ${event.toolCall.name}...`);
      break;
    case "tool-call-end":
      console.log(`✓ ${event.toolCall.name} (${event.toolCall.duration}ms)`);
      break;
    case "step-complete":
      console.log(`-- step ${event.step} --`);
      break;
    case "done":
      console.log(`\nFinal: ${event.result.output}`);
      break;
  }
}
```

Between `tool-call-start` and `tool-call-end` the model is paused — tools execute server-side and the model resumes once they return. There are no `text-delta` events during tool execution.

## Cancellation

Pass an `AbortSignal` to cancel mid-stream:

```typescript
import { InvocationCancelledError } from "agntz";

const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);

const stream = runner.stream("writer", "…", { signal: controller.signal });

try {
  for await (const event of stream) {
    if (event.type === "text-delta") process.stdout.write(event.text);
  }
} catch (err) {
  if (err instanceof InvocationCancelledError) {
    console.log("\n(cancelled)");
  }
}
```

The model call is aborted, in-flight tools are not awaited, and the iterator closes.

## Streaming over HTTP

The Worker exposes streaming on two endpoints:

- `POST /run/stream` — one-shot synchronous run with SSE (events: `run-start`, `run-complete`/`run-error`)
- `GET /runs/:id/stream` — multiplexed events for a tracked Run, with `?since=N` for resume

`@agntz/sdk` wraps both with async-generator APIs (see [the SDK client chapter](/guide/18-sdk-client)):

```typescript
import { AgntzClient } from "@agntz/sdk";

const client = new AgntzClient({ apiKey, baseUrl });

for await (const event of client.agents.stream({ agentId: "writer", input: "…" })) {
  if (event.type === "text-delta") process.stdout.write(event.text);
}
```

## The InvokeStream interface

The return type of `runner.stream()`:

```typescript
// packages/core/src/types.ts:194-197
interface InvokeStream extends AsyncIterable<StreamEvent> {
  result: Promise<InvokeResult>;
}
```

You can use the iterable, the promise, or both — but only iterate once, since consuming events advances the underlying state. `stream.result` resolves once the iterator finishes; you can await it without manually iterating if you only want the final value.
