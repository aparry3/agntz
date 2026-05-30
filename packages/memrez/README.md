# @agntz/memrez

Durable tagged memory for agntz agents.

memrez stores facts, preferences, events, and summaries under namespace scopes. It plugs into agntz through the generic resource provider system, so agents get memory tools such as `memory_read` and `memory_write` while application code keeps control of runtime namespace grants.

## Install

```bash
pnpm add @agntz/memrez
```

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
const topics = await memrez.scan(grants);
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
- `mode: read` exposes read tools only.
- `mode: read-write` exposes read and write tools.
- The memory provider validates writes against runtime grants and `writePolicy`.
- The model never receives a namespace parameter.

See the public docs for the full guide: `/docs/tools/memory-memrez`.
