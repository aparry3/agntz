export default `# Embedded SDK

The embedded runner reads YAML manifests from disk, registers them in an in-process runtime, and runs them locally with no network hop. Use \`@agntz/sdk\` in TypeScript or \`agntz\` in Python. Both load the same agent YAML and expose the same resource shape with language-native option names.

\`\`\`bash {group=sdk-install select=ts}
pnpm add @agntz/sdk
\`\`\`

\`\`\`bash {group=sdk-install select=python}
pip install "agntz[litellm]"
\`\`\`

Node 20+ for TypeScript. Python 3.11+ for Python. Universal clients that cannot read from the local filesystem should use the hosted client instead.

## Basic usage

\`\`\`ts [index.ts] {group=sdk-basic}
import { agntz, tool, z } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tools: [
    tool({
      name: "add",
      description: "Add two numbers and return the sum",
      input: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    }),
  ],
  onEvent: (event) => {
    if (event.type === "tool-call-start") console.log("→", event.toolCall.name);
  },
});

const { output, state } = await client.agents.run({
  agentId: "support",
  input: { message: "Hello" },
});
\`\`\`

\`\`\`python [main.py] {group=sdk-basic}
from pydantic import BaseModel
from agntz import LiteLLMModelProvider, agntz, tool


class AddInput(BaseModel):
    a: float
    b: float


def add(args: AddInput) -> float:
    return args.a + args.b


client = agntz(
    agents="./agents",
    tools=[
        tool(
            name="add",
            description="Add two numbers and return the sum",
            input_schema=AddInput,
            execute=add,
        )
    ],
    model_provider=LiteLLMModelProvider(),
)

result = client.agents.run(
    agent_id="support",
    input={"message": "Hello"},
)
output = result.output
state = result.state
\`\`\`

## \`agntz(options)\`

Returns an initialized local client. Validation errors throw at startup, so misconfigured agents do not make it past process boot.

| TypeScript option | Python option | Description |
|---|---|---|
| \`agents\` | \`agents\` | Path to a directory of \`.yaml\` files |
| \`tools\` | \`tools\` | Local tool definitions |
| \`store\` | \`store\` | Optional persistence |
| \`defaultModel\` | \`model_provider\` | Python passes a concrete provider; TypeScript can default model config |
| \`onEvent\` | N/A | TypeScript event hook for full local event stream |

## Runtime API

### Run an agent

\`\`\`ts {group=sdk-run}
const { output, state, sessionId } = await client.agents.run({
  agentId: "summarize",
  input: { text: longArticle },
  sessionId: "user-42",
});
\`\`\`

\`\`\`python {group=sdk-run}
result = client.agents.run(
    agent_id="summarize",
    input={"text": long_article},
    session_id="user-42",
)
output = result.output
state = result.state
session_id = result.session_id
\`\`\`

### Stream or inspect

\`\`\`ts {group=sdk-stream}
for await (const event of client.agents.stream({
  agentId: "summarize",
  input: { text: longArticle },
  signal: AbortSignal.timeout(30_000),
})) {
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "complete") return event.output;
}
\`\`\`

\`\`\`python {group=sdk-stream}
for event in client.agents.stream(
    agent_id="summarize",
    input={"text": long_article},
):
    if event.type == "complete":
        print(event.output)
\`\`\`

TypeScript local streaming includes token deltas and tool-loop events. Python local streaming currently emits start and complete snapshots; use the hosted Python client for full worker SSE streaming.

### Runs and traces

\`\`\`ts {group=sdk-runs}
const { rows } = await client.runs.list({ agentId, status, limit: 10 });
const run = await client.runs.get(rows[0].id);
const trace = await client.traces.get(rows[0].id);
\`\`\`

\`\`\`python {group=sdk-runs}
runs = client.runs.list(agent_id=agent_id, status="completed")
run = client.runs.get(runs[0].id)
trace_rows = client.traces.list(agent_id=agent_id)
trace = client.traces.get(trace_rows["rows"][0]["traceId"])
\`\`\`

## Persistence

\`\`\`ts {group=sdk-persistence}
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});
\`\`\`

\`\`\`python {group=sdk-persistence}
from agntz import LiteLLMModelProvider, SQLiteStore, agntz

client = agntz(
    agents="./agents",
    store=SQLiteStore("./agntz.db"),
    model_provider=LiteLLMModelProvider(),
)
\`\`\`

The same store backs sessions, runs, and traces. Python's SQLite store persists messages and trace spans in the same file.

## Errors

\`\`\`ts {group=sdk-errors}
import { AgntzError, NotFoundError, StreamError } from "@agntz/sdk";

try {
  await client.agents.run({ agentId: "unknown", input: {} });
} catch (err) {
  if (err instanceof NotFoundError) {
    // unknown agent id
  }
}
\`\`\`

\`\`\`python {group=sdk-errors}
try:
    client.agents.run(agent_id="unknown", input={})
except RuntimeError as exc:
    print(exc)
\`\`\`

The hosted clients expose structured HTTP error classes. Local embedded execution raises Python or TypeScript runtime errors directly.

## Switching to hosted

When you're ready to graduate, swap constructors and keep the same resource shape:

\`\`\`diff {group=sdk-hosted}
- import { agntz } from "@agntz/sdk";
+ import { AgntzClient } from "@agntz/client";

- const client = await agntz({ agents: "./agents" });
+ const client = new AgntzClient({
+   apiKey: process.env.AGNTZ_API_KEY!,
+   baseUrl: "https://api.agntz.co",
+ });
\`\`\`

\`\`\`python {group=sdk-hosted}
import os
from agntz import AgntzClient

client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
)
\`\`\`

\`agents.run\`, \`runs.list\`, and \`traces.get\` stay the same. Local tools must be promoted to HTTP or MCP servers when the runtime moves out of your process.
`;
