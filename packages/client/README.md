# @agntz/client

Official TypeScript HTTP client for hosted Agntz and self-hosted workers. It
runs in Node 22+ and modern browsers, with zero runtime dependencies.

## Install

```sh
pnpm add @agntz/client
```

## Usage

```ts
import { AgntzClient, type ContentBlock } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: process.env.AGNTZ_WORKER_URL ?? "https://api.agntz.co",
});

const result = await client.agents.run({
  agentId: "support",
  input: { message: "Can I change my shipping address?" },
  sessionId: "user-42",
  context: ["app/user/u_123"],
});

console.log(result.output);
console.log(result.model, result.usage, result.resolvedAgentVersion);
```

`agents.run`, `agents.stream`, and `agents.start` share one input contract.
The active manifest kind selects text generation, structured output,
transcription, or image generation.

The normalized result also includes `runId`, optional `traceId` / `sessionId`,
requested and resolved agent versions, provider, actual model, finish reason,
provider response id, warnings, and retention metadata.

## Rich content, artifacts, and retention

Local image and audio files are uploaded automatically and replaced with
tenant-scoped artifact references before the run starts:

```ts
const transcript = await client.agents.run({
  agentId: "social-narration-transcription",
  content: [
    {
      type: "audio",
      file: { path: "./narration.mp3", mediaType: "audio/mpeg" },
    },
  ],
  retention: {
    mode: "none",
    artifactTtlSeconds: 3600,
  },
});

console.log(transcript.output, transcript.model, transcript.usage);
```

Use `mode: "none"` for synchronous stateless calls, `"result"` to retain a
redacted result/run record, and `"session"` for conversation history and
traces. Durable `agents.start`/`runs.start` calls require `result` or `session`.

Artifacts can also be managed explicitly:

```ts
const artifact = await client.artifacts.upload({
  file: { path: "./frame.png", mediaType: "image/png" },
  expiresInSeconds: 3600,
});
const imageBlob = await client.artifacts.download(artifact.id);
await client.artifacts.delete(artifact.id);
```

Content blocks preserve order:

```ts
const content = [
  { type: "text", text: "Compare these frames." },
  { type: "image", url: "https://example.com/one.png", detail: "high" },
  { type: "image", base64: encodedPng, mediaType: "image/png" },
  { type: "image", artifactId: artifact.id },
] satisfies ContentBlock[];
```

Images accept `auto`, `low`, or `high` detail. Audio blocks accept URL, base64,
artifact id, or local file sources. Node supports path objects, byte arrays,
`ArrayBuffer`, and `Blob`; browser code should use `Blob` or uploaded artifact
ids.

`ttlSeconds` and `artifactTtlSeconds` accept 60 seconds through one year.
Explicit input uploads are capped at seven days by the worker. A caller may
tighten a manifest retention default but cannot loosen it.

## Transcription and image output

Transcription manifests return:

```ts
{
  text: string;
  segments?: unknown[];
  language?: string;
  durationInSeconds?: number;
}
```

Image manifests return managed references:

```ts
{
  artifacts: Array<{
    artifactId: string;
    mediaType: string;
    sizeBytes: number;
    expiresAt: string;
  }>;
}
```

Download generated images with `client.artifacts.download(artifactId)`.
Built-in hosted transcription and image adapters currently use OpenAI.

## Streaming

```ts
const controller = new AbortController();

for await (const event of client.agents.stream({
  agentId: "support",
  input: { message: "Hello" },
  signal: controller.signal,
})) {
  if (event.type === "start") console.log("started", event.kind);
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "complete") console.log("output", event.output);
  if (event.type === "error") console.error(event.error);
}
```

## Resource surface

```ts
await client.health();

await client.agents.import({
  agents: [{ id: "support", manifest: supportYaml }],
});
const agents = await client.agents.list();
const agent = await client.agents.get("support");

const run = await client.runs.start({ agentId: "support", input: "hi" });
await client.runs.get(run.id);
await client.runs.cancel(run.id);
await client.runs.list({ agentId: "support", status: "completed" });

const traces = await client.traces.list({ agentId: "support" });
const traceId = traces.rows[0]?.traceId;
if (traceId) {
  await client.traces.get(traceId);
  await client.traces.delete(traceId);
}

await client.sessions.import({ sessions });
await client.sessions.list({ agentId: "support" });
await client.sessions.get("user-42");
await client.sessions.delete("user-42");
```

## Memory

Memory calls are grant-bounded. Pass the same namespace grants you use in run
`context`.

```ts
const grants = ["app/user/u_123"];

await client.memory.import({ entries });
await client.memory.scan(grants);
await client.memory.list(grants, { limit: 20 });
await client.memory.read(grants, "prefs");
await client.memory.correct(grants, entryId, "Prefers email receipts");
await client.memory.deleteEntry(grants, entryId);
await client.memory.curate(grants);
await client.memory.deleteScope(grants, "app/user/u_123", { recursive: true });
```

## Datasets and evals

```ts
await client.datasets.create(dataset);
await client.datasets.list({ agentId: "support" });
await client.datasets.get("refund-cases");
await client.datasets.update("refund-cases", { description: "Updated" });
await client.datasets.delete("refund-cases");

await client.evals.create(definition);
await client.evals.list({ agentId: "support" });
await client.evals.get("support-quality");

const evalRun = await client.evals.run({
  evalId: "support-quality",
  datasetId: "refund-cases",
  agentVersion: "2026-06-18T15:30:00.000Z",
});

await client.evals.getRun(evalRun.id);
await client.evals.cancelRun(evalRun.id);
await client.evals.listRuns({ evalId: "support-quality" });
await client.evals.getLatestScore({
  evalId: "support-quality",
  datasetId: "refund-cases",
  resolvedAgentVersion: "2026-06-18T15:30:00.000Z",
});
await client.evals.listLatestScores({ evalId: "support-quality" });
```

## Auth

The client sends:

```txt
Authorization: Bearer ar_live_...
```

Generate API keys from the hosted app or your self-hosted UI. Do not embed live
API keys in browser code; proxy through your own backend.

## Errors and cancellation

- `AgntzError` is the base class for client errors.
- `AuthenticationError` represents 401 responses.
- `NotFoundError` represents 404 responses.
- `StreamError` represents SSE protocol failures.

`AgntzError` preserves the worker's stable `code` and HTTP `status`; check
`error.status === 429` for rate limiting.

Pass an `AbortSignal` via `signal` on any call, or `defaultSignal` on the
client. Breaking from a `for await` stream loop closes the underlying response.

## Documentation

- [Provider replacement](https://agntz.co/docs/hosted/provider-replacement)
- [Content, artifacts, and retention](https://agntz.co/docs/hosted/content-artifacts-retention)
- [Transcription and image generation](https://agntz.co/docs/hosted/transcription-images)
- [Results, streaming, and errors](https://agntz.co/docs/hosted/results-errors)
