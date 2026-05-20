# @agntz/runner

Embedded in-process runner for agntz agents. Five lines of code, one YAML file, and you're running an AI agent — no server, no signup, no infrastructure.

When you outgrow embedded mode, swap one import line and the same code runs against the hosted [@agntz/sdk](https://www.npmjs.com/package/@agntz/sdk) client.

## Install

```bash
pnpm add @agntz/runner
# or: npm install @agntz/runner
# or: yarn add @agntz/runner
```

## Quick start

Create an agent YAML at `agents/support.yaml`:

```yaml
id: support
kind: llm
model:
  provider: anthropic
  name: claude-sonnet-4-6
instruction: |
  You are a friendly customer support agent. Answer concisely.

  {{userQuery}}
```

Run it:

```ts
import { agntz } from "@agntz/runner";

const client = await agntz({ agents: "./agents" });
const result = await client.agents.run({
  agentId: "support",
  input: "How do I reset my password?",
});
console.log(result.output);
```

Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`, etc. — whichever provider you used) in your environment and run the file. That's it.

## Local tools

The model can call functions you define in code. Reference them in YAML by name, pass implementations at init:

```yaml
# agents/calculator.yaml
id: calculator
kind: llm
model: { provider: openai, name: gpt-5.4-mini }
instruction: |
  Use the `add` tool to answer math questions.

  {{userQuery}}
tools:
  - kind: local
    tools: [add]
```

```ts
const client = await agntz({
  agents: "./agents",
  tools: {
    add: async ({ a, b }: { a: number; b: number }) => a + b,
  },
});
```

Names referenced in YAML but missing from the `tools` map fail at load time, not on first model call.

## HTTP tools with credentials

Reference env vars with `{{env.NAME}}` — resolved from `process.env` automatically:

```yaml
tools:
  - kind: http
    name: get_user
    url: "https://api.example.com/users/{userId}"
    headers:
      Authorization: "Bearer {{env.MY_API_TOKEN}}"
```

Missing env vars throw at invoke time with a clear error so misconfigurations surface fast.

## Sessions

By default, sessions are in-memory and reset on process restart. For persistence, install `@agntz/store-sqlite` and use the `sqlite` subpath:

```bash
pnpm add @agntz/store-sqlite
```

```ts
import { agntz } from "@agntz/runner";
import { sqliteStore } from "@agntz/runner/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});

// Pass the same sessionId across runs to continue a conversation:
await client.agents.run({ agentId: "support", input: "hi", sessionId: "user-42" });
await client.agents.run({ agentId: "support", input: "follow-up", sessionId: "user-42" });
```

## Runs and traces

Every invocation is recorded in an in-memory ring buffer (default 1000 entries):

```ts
const { rows } = await client.runs.list({ limit: 10 });
for (const run of rows) {
  console.log(run.agentId, run.status, run.result?.output);
}

const trace = await client.traces.get(rows[0].id);
console.log(trace?.spans);
```

For real-time observability during streaming, pass `onEvent`:

```ts
const client = await agntz({
  agents: "./agents",
  onEvent: (event) => {
    if (event.type === "tool-call-start") console.log("→", event.toolCall.name);
    if (event.type === "text-delta") process.stdout.write(event.text);
  },
});
```

## Streaming

```ts
for await (const event of client.agents.stream({ agentId: "support", input: "..." })) {
  if (event.type === "complete") {
    console.log("\nfinal:", event.output);
  } else if (event.type === "reply") {
    console.log("partial:", event.text);
  }
}
```

## Graduating to the hosted API

When you outgrow embedded mode — multi-user isolation, durable run history, hosted observability, agent push from CI — swap your import:

```diff
- import { agntz } from "@agntz/runner";
+ import { agntz } from "@agntz/sdk";

- const client = await agntz({ agents: "./agents", tools });
+ const client = agntz({ apiKey: process.env.AGNTZ_API_KEY });
```

The `client.agents.run / .stream`, `client.runs.list / .get`, and `client.traces.list / .get` calls work identically. YAML manifests move to the hosted registry; local tool handlers don't graduate (those become hosted MCP servers or HTTP endpoints).

## What's supported in embedded mode

| Feature | Embedded | Hosted SDK |
|---|---|---|
| LLM agents | ✓ | ✓ |
| Sequential / parallel / tool agent kinds | ✓ | ✓ |
| Local tools (in-process JS/TS) | ✓ | (use MCP/HTTP instead) |
| HTTP tools | ✓ | ✓ |
| MCP tools (raw URL + headers) | ✓ | ✓ |
| Agent-as-tool (subagent calls) | ✓ | ✓ |
| Spawnable subagents | ✓ | ✓ |
| Sessions | ✓ (memory or sqlite) | ✓ (managed) |
| Runs / traces | ✓ (in-memory) | ✓ (persisted) |
| Streaming for LLM agents | ✓ (full event stream) | ✓ |
| Streaming for pipelines | ✓ (single `complete` event) | ✓ |
| `{{env.X}}` template refs | ✓ | (opt-in per server) |
| `{{secrets.X}}` template refs | × | ✓ |
| Skills | × | ✓ |
| Evals | × | (planned) |
| Multi-user isolation | × | ✓ |

## MCP tools

MCP servers work via raw URL + optional headers. No connection store
required for embedded mode:

```yaml
tools:
  - kind: mcp
    server: "https://search.example.com/mcp"
    tools: [search, fetch_url]
    headers:
      Authorization: "Bearer {{env.SEARCH_API_KEY}}"
```

The runner connects lazily on first tool call and reuses the connection
for the lifetime of the process.

## License

MIT
