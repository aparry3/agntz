export default `# @agntz/sdk

The embedded runner. Reads YAML manifests from disk, registers them in an in-process runtime, and runs them locally with no network hop. Same API shape as [@agntz/client](/docs/sdk-cli/client) — code is portable between embedded and hosted modes.

\`\`\`bash
pnpm add @agntz/sdk
\`\`\`

Node 20+. Universal SDK consumers (browsers, edge) should use \`@agntz/client\` instead — the SDK reads YAML from the filesystem.

## Basic usage

\`\`\`ts
import { agntz } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tools: { add: async ({ a, b }) => a + b },
  onEvent: (event) => {
    if (event.type === "tool-call-start") console.log("→", event.toolCall.name);
  },
});

// Non-streaming
const { output, state } = await client.agents.run({
  agentId: "support",
  input: { message: "Hello" },
});

// Streaming
for await (const event of client.agents.stream({
  agentId: "support",
  input: { message: "Hello" },
})) {
  if (event.type === "reply") process.stdout.write(event.text);
  if (event.type === "complete") console.log("\\nfinal:", event.output);
}

// Runs & traces (in-memory ring buffer, default 1000)
const { rows } = await client.runs.list({ limit: 10 });
const trace = await client.traces.get(rows[0].id);
\`\`\`

## \`agntz(options)\`

Returns an initialized client. Most fields are optional.

| Field | Type | Description |
|---|---|---|
| \`agents\` | \`string\` | Path to a directory of \`.yaml\` files, or a single \`.yaml\` file |
| \`tools\` | \`Record<string, Tool>\` | [Local tools](/docs/tools/local) keyed by name |
| \`store\` | \`Store\` | Optional persistence (e.g. \`sqliteStore(path)\` from \`@agntz/sdk/sqlite\`) |
| \`skills\` | \`SkillStore\` | Skill registry resolving \`use_skill\` references |
| \`telemetry\` | \`TelemetryOptions\` | Optional OpenTelemetry tracer + recording flags |
| \`onEvent\` | \`(event) => void\` | Synchronous event hook fired for every stream event (across all runs) |
| \`defaultModel\` | \`ModelConfig\` | Default \`provider\` + \`name\` for agents missing \`model:\` |

Loading is **sync from the caller's perspective** — \`agntz\` returns a promise that resolves once all manifests have been parsed, validated, and registered. Validation errors throw at this point, so misconfigured agents never make it past startup.

## Runtime API

### \`client.agents.run({ agentId, input, sessionId? })\`

Run an agent to completion. Returns \`{ output, state, runId, sessionId, replies }\`.

\`\`\`ts
const { output, state } = await client.agents.run({
  agentId: "summarize",
  input: { text: longArticle },
});
\`\`\`

### \`client.agents.stream({ agentId, input, sessionId?, signal? })\`

Async iterator over stream events. Always yields a terminal event (\`complete\` or \`error\`).

\`\`\`ts
for await (const event of client.agents.stream({
  agentId: "summarize",
  input: { text: longArticle },
  signal: AbortSignal.timeout(30_000),
})) {
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "complete") return event.output;
}
\`\`\`

### \`client.runs.*\`

\`\`\`ts
const { rows, nextCursor } = await client.runs.list({ agentId, status, limit, cursor });
const run = await client.runs.get(runId);
await client.runs.cancel(runId);              // cascades to descendant runs
\`\`\`

In embedded mode runs live in a ring buffer (default capacity 1000); install \`@agntz/store-sqlite\` for durability.

### \`client.traces.*\`

\`\`\`ts
const trace = await client.traces.get(runId);
for await (const event of client.traces.stream(runId)) {
  if (event.type === "span-end") console.log(event.span.name, event.span.durationMs);
}
\`\`\`

### \`client.manifests\`

A \`Map<string, ManifestRecord>\` of all loaded agents. Useful for introspection — e.g. listing every agent at boot time.

\`\`\`ts
for (const [id, manifest] of client.manifests) {
  console.log(id, manifest.kind, manifest.description);
}
\`\`\`

## Stream events

| \`event.type\` | When | Payload |
|---|---|---|
| \`start\` | First event of a run | \`{ runId, kind }\` |
| \`text-delta\` | Streaming token from the model | \`{ text }\` |
| \`tool-call-start\` | Model invoked a tool | \`{ toolCall }\` |
| \`tool-call-end\` | Tool returned | \`{ toolCall, result }\` |
| \`reply\` | Model called the \`reply\` tool (if enabled) | \`{ text }\` |
| \`step-complete\` | One tool-loop iteration finished | \`{ step }\` |
| \`complete\` | Terminal — full result | \`{ output, state, usage }\` |
| \`error\` | Terminal — failure | \`{ error }\` |

Always handle \`complete\` and \`error\` as terminal. \`break\` from a \`for await\` loop cleans up the underlying stream automatically.

Pipelines emit a single \`complete\` event at the end (no token-level streaming). LLM agents emit \`text-delta\` events as the model streams.

## Persistence — \`@agntz/store-sqlite\`

Install the SQLite adapter and pass \`store:\`:

\`\`\`ts
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});
\`\`\`

The same store backs sessions, runs, and traces — durability across the whole SDK surface, single file.

## Errors

\`\`\`ts
import { AgntzError, AuthenticationError, NotFoundError, StreamError } from "@agntz/sdk";

try {
  await client.agents.run({ agentId: "unknown", input: {} });
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — unknown agent id
  }
  if (err instanceof StreamError) {
    // SSE / stream protocol failure
  }
}
\`\`\`

All errors extend \`AgntzError\`. The hosted client (\`@agntz/client\`) re-exports the same types, so error-handling code is portable.

## Switching to hosted

When you're ready to graduate, the only code change is the import and constructor:

\`\`\`diff
- import { agntz } from "@agntz/sdk";
+ import { AgntzClient } from "@agntz/client";

- const client = await agntz({ agents: "./agents" });
+ const client = new AgntzClient({ apiKey: process.env.AGNTZ_API_KEY! });
\`\`\`

\`agents.run\`, \`agents.stream\`, \`runs.list\`, and \`traces.get\` work identically. Local tools must be promoted to HTTP or MCP servers (see [Compatibility matrix](/docs/compatibility)).
`;
