export default `# Memory with memrez

memrez is the durable memory resource for agntz agents. It stores tagged facts, preferences, events, and summaries under namespace scopes, then exposes memory to LLM agents through the generic \`resources:\` system.

It is not session history. It is not the legacy \`contextIds\` scratchpad. memrez is long-lived resource state guarded by runtime \`context\` namespace grants.

## Install

\`\`\`bash {group=memrez-install select=ts}
pnpm add @agntz/memrez
\`\`\`

\`\`\`bash {group=memrez-install select=python}
pip install agntz
\`\`\`

The TypeScript package is published as \`@agntz/memrez\`. The Python package exports matching primitives from \`agntz.memrez\`, \`agntz.memrez_sqlite\`, \`agntz.memrez_postgres\`, and \`agntz.memrez_provider\`.

## Declare a memory resource

\`\`\`yaml [agents/support-with-memory.yaml]
id: support-with-memory
name: Support with Memory
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: |
  Help the user. Use memory when it is relevant, and write only stable facts or preferences.
resources:
  memory:
    mode: read-write
    autoScan: true
\`\`\`

When this agent runs, the memory provider can add visible topic summaries to the prompt and expose tools named \`memory_read\` and \`memory_write\`.

Use \`mode: read\` when an agent may read memory but must not write it. In read mode, the write tool is not registered.

## Wire the provider

\`\`\`ts [index.ts] {group=memrez-provider}
import { agntz } from "@agntz/sdk";
import { createMemrez, SqliteMemoryStore } from "@agntz/memrez";

const memrez = createMemrez({
  store: new SqliteMemoryStore("./memory.db"),
});

const client = await agntz({
  agents: "./agents",
  resources: { memory: memrez.provider() },
});
\`\`\`

\`\`\`python [main.py] {group=memrez-provider}
from agntz import LiteLLMModelProvider, agntz
from agntz.memrez import create_memrez
from agntz.memrez_sqlite import SqliteMemoryStore

memrez = create_memrez(store=SqliteMemoryStore("./memory.db"))

client = agntz(
    agents="./agents",
    resources={"memory": memrez.provider()},
    model_provider=LiteLLMModelProvider(),
)
\`\`\`

The key in \`resources: { memory: ... }\` is the provider kind. It must match the manifest resource kind. If the manifest omits \`kind\`, the resource name is used as the kind.

## Run with namespace grants

Pass \`context\` from trusted application code. Do not ask the model to pick a namespace.

\`\`\`ts {group=memrez-run}
await client.agents.run({
  agentId: "support-with-memory",
  input: "Remember that I prefer metric units.",
  context: ["app/user/" + userId],
});
\`\`\`

\`\`\`python {group=memrez-run}
client.agents.run(
    agent_id="support-with-memory",
    input="Remember that I prefer metric units.",
    context=[f"app/user/{user_id}"],
)
\`\`\`

The memory tools receive the normalized grant list. A write can only land inside a writable scope allowed by those grants and the memory write policy.

## Read and write directly

You can also use memrez outside an agent, which is useful for tests, backfills, and admin jobs.

\`\`\`ts {group=memrez-direct}
const grants = ["app/user/" + userId];

await memrez.write(grants, "Prefers metric units.", {
  topicsHint: ["preferences"],
});

const entries = await memrez.read(grants, "preferences", { limit: 10 });
\`\`\`

\`\`\`python {group=memrez-direct}
grants = [f"app/user/{user_id}"]

memrez.write(
    grants,
    "Prefers metric units.",
    topics_hint=["preferences"],
)

entries = memrez.read(grants, "preferences", limit=10)
\`\`\`

Direct calls use the same grant validation as resource tool calls.

## Storage options

| Store | TypeScript | Python | Use case |
|---|---|---|---|
| In-memory | \`InMemoryMemoryStore\` | default \`create_memrez()\` store | Tests and demos |
| SQLite | \`SqliteMemoryStore\` | \`SqliteMemoryStore\` | Local apps and single-node deployments |
| Postgres | \`PostgresMemoryStore\` | \`PostgresMemoryStore\` | Multi-process and hosted deployments |

\`\`\`ts {group=memrez-store}
import { createMemrez, PostgresMemoryStore } from "@agntz/memrez";

const memrez = createMemrez({
  store: new PostgresMemoryStore(process.env.DATABASE_URL!),
});
\`\`\`

\`\`\`python {group=memrez-store}
import os
from agntz.memrez import create_memrez
from agntz.memrez_postgres import PostgresMemoryStore

memrez = create_memrez(
    store=PostgresMemoryStore(os.environ["DATABASE_URL"]),
)
\`\`\`

## Auto-scan

\`autoScan: true\` lets the provider inject a small list of visible memory topics before the model starts tool calling.

\`\`\`text
## Resource: memory
Memory topics visible to this run:
- preferences (3) - durable user preferences
- billing (1)
\`\`\`

Set \`autoScan: false\` when you want the model to discover memory only through explicit \`memory_read\` calls.

## Write policy

By default, memrez writes to the current grant or one of its descendants. It does not promote writes to ancestors unless configured.

\`\`\`yaml
resources:
  memory:
    mode: read-write
    writePolicy:
      descendants: true
      ancestorPromotion: none
\`\`\`

Use ancestor promotion only for trusted agents that are designed to curate shared memory. Normal user-facing agents should receive narrow grants such as \`app/user/u_123\`.

## Reasoning layer

memrez uses a reasoner to organize memory writes — choosing topics, entry type, normalized content, and target namespace — and to curate scopes. By default \`createMemrez({ store })\` wires a built-in LLM reasoner that makes direct model calls, keyed from your provider env var (e.g. \`OPENAI_API_KEY\`). That is why the agent's \`memory_write\` tool takes content only: filing the entry is memrez's job, not the agent's.

Override the reasoner when you want different models, or no LLM at all for tests / emergency fallback:

\`\`\`ts
import {
  createMemrez,
  llmReasoner,
  DeterministicReasoner,
} from "@agntz/memrez";

createMemrez({ store, reasoner: llmReasoner({ taggerModel: { provider: "anthropic", name: "claude-haiku-4-5" } }) });
createMemrez({ store, reasoner: new DeterministicReasoner() }); // no LLM (tests / kill-switch)
\`\`\`

memrez does not run its tagger or curator through the agntz agent loop yet.
Those steps are bounded structured model calls owned by memrez, which avoids
circular setups where memory writes invoke agents that can themselves use
memory.

The reasoner may propose a namespace, but memrez validates it before writing. The model cannot bypass the grant boundary.

## Hosted use

Hosted workers accept the same run-time \`context\` field over the HTTP API and hosted clients. The deployment decides which resource providers are wired into the worker. When using a hosted memory provider, mint grants from authenticated server-side state and pass them with the run request.

## Where to go next

- **[Context and resources](/docs/concepts/context-and-resources)** - how namespace grants work.
- **[Resources schema](/docs/schema/resources)** - every \`resources:\` field.
- **[Hosted client](/docs/sdk-cli/client)** - passing \`context\` to hosted runs.
`;
