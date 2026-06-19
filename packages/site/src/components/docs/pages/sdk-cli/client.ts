export default `# Hosted client

The hosted client calls agents on \`agntz.co\` or your self-hosted worker over HTTPS. TypeScript uses \`@agntz/client\`; Python uses \`agntz.AgntzClient\` or \`agntz.AsyncAgntzClient\`. Both talk to the same worker API.

\`\`\`bash {group=client-install select=ts}
pnpm add @agntz/client
\`\`\`

\`\`\`bash {group=client-install select=python}
pip install agntz
\`\`\`

Same resource shape as the embedded SDK — code is portable between local and hosted modes once your local tools are HTTP or MCP tools.

## Basic usage

\`\`\`ts [index.ts] {group=client-basic}
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,    // ar_live_...
  baseUrl: "https://api.agntz.co",       // or your self-hosted worker URL
});

const { output, state } = await client.agents.run({
  agentId: "support-agent",
  input: { message: email.body, customerId: email.from },
});
\`\`\`

\`\`\`python [main.py] {group=client-basic}
import os
from agntz import AgntzClient

client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
)

result = client.agents.run(
    agent_id="support-agent",
    input={"message": email.body, "customerId": email.from},
)
output = result.output
state = result.state
\`\`\`

## Async usage

\`\`\`ts {group=client-async}
for await (const event of client.agents.stream({
  agentId: "support-agent",
  input: { message: "Hello" },
})) {
  if (event.type === "complete") console.log("output", event.output);
  if (event.type === "error") console.error(event.error);
}
\`\`\`

\`\`\`python {group=client-async}
import os
from agntz import AsyncAgntzClient

async with AsyncAgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
) as client:
    async for event in client.agents.stream(
        agent_id="support-agent",
        input={"message": "Hello"},
    ):
        if event.type == "complete":
            print("output", event.output)
        if event.type == "error":
            print("error", event.error)
\`\`\`

## Constructor options

\`\`\`ts {group=client-constructor}
new AgntzClient({
  apiKey: "ar_live_...",
  baseUrl: "https://api.agntz.co",
});
\`\`\`

\`\`\`python {group=client-constructor}
AgntzClient(
    api_key="ar_live_...",
    base_url="https://api.agntz.co",
)
\`\`\`

## API surface

### \`client.agents.run(...)\`

Run an agent to completion. Returns \`{ output, state, sessionId, replies }\` in TypeScript and the same fields as Python attributes such as \`result.session_id\`.

### \`client.agents.stream(...)\`

Streams SSE events. Always yields a terminal \`complete\` or \`error\` event.

### \`client.agents.import(...)\`

Import local manifests into hosted storage. Imported agents become available to the same run and stream APIs.

\`\`\`ts {group=client-agent-import}
await client.agents.import({
  agents: [{ id: "support", manifest: supportYaml }],
});
\`\`\`

\`\`\`python {group=client-agent-import}
client.agents.import_(
    agents=[{"id": "support", "manifest": support_yaml}],
)
\`\`\`

Stored agents can be resolved by bare id, \`agent@latest\`, exact version timestamp, or alias when the deployment exposes version and alias administration.

### Runtime context grants

Pass \`context\` when a hosted run needs access to a resource such as memory. These are namespace grants minted by trusted server-side code; the model never receives a namespace parameter.

\`\`\`ts {group=client-context}
const result = await client.agents.run({
  agentId: "support-with-memory",
  input: "What do you remember about me?",
  sessionId: "user-42",
  context: ["app/user/u_123"],
});
\`\`\`

\`\`\`python {group=client-context}
result = client.agents.run(
    agent_id="support-with-memory",
    input="What do you remember about me?",
    session_id="user-42",
    context=["app/user/u_123"],
)
\`\`\`

The worker must be configured with matching resource providers. See [Context and resources](/docs/concepts/context-and-resources) and [Memory with memrez](/docs/tools/memory-memrez).

### \`client.runs.*\`

\`\`\`ts {group=client-runs}
const run = await client.runs.start({ agentId, input: { /* ... */ } });
const fresh = await client.runs.get(run.id);
await client.runs.cancel(run.id);

const { rows, nextCursor } = await client.runs.list({
  agentId,
  status,
  limit,
});
\`\`\`

\`\`\`python {group=client-runs}
run = client.runs.start(agent_id=agent_id, input={})
fresh = client.runs.get(run.id)
client.runs.cancel(run.id)

rows = client.runs.list(
    agent_id=agent_id,
    status="completed",
    limit=20,
)
\`\`\`

### \`client.traces.*\`

\`\`\`ts {group=client-traces}
const trace = await client.traces.get(runId);
const list = await client.traces.list({ status: "error" });
await client.traces.delete(traceId);
\`\`\`

\`\`\`python {group=client-traces}
trace = client.traces.get(run_id)
traces = client.traces.list(status="error")
client.traces.delete(trace_id)
\`\`\`

## Sessions

Pass the same session id across calls to continue a conversation. The hosted runtime auto-loads and appends history.

\`\`\`ts {group=client-sessions}
await client.agents.run({ agentId: "support", input: "Hi", sessionId: "user-42" });
await client.agents.run({ agentId: "support", input: "follow-up", sessionId: "user-42" });
\`\`\`

\`\`\`python {group=client-sessions}
client.agents.run(agent_id="support", input="Hi", session_id="user-42")
client.agents.run(agent_id="support", input="follow-up", session_id="user-42")
\`\`\`

Sessions are managed automatically and scoped to your user. See [Sessions](/docs/concepts/sessions).

You can also import or delete sessions when migrating local state:

\`\`\`ts {group=client-session-import}
await client.sessions.import({
  sessions: [{ id: "user-42", messages }],
});

await client.sessions.delete("user-42");
\`\`\`

\`\`\`python {group=client-session-import}
client.sessions.import_(
    sessions=[{"id": "user-42", "messages": messages}],
)

client.sessions.delete("user-42")
\`\`\`

## Memory

Hosted memory APIs mirror the embedded memrez admin surface. All requests are bounded by namespace roots and runtime \`context\` grants.

\`\`\`ts {group=client-memory}
await client.memory.import({ entries });

const topics = await client.memory.scan(["app/user/u_123"]);

const entries = await client.memory.list(["app/user/u_123"], {
  limit: 20,
});

await client.memory.correct(
  ["app/user/u_123"],
  entryId,
  "Prefers email receipts",
);

await client.memory.deleteEntry(["app/user/u_123"], entryId);
\`\`\`

\`\`\`python {group=client-memory}
client.memory.import_(entries=entries)

topics = client.memory.scan(grants=["app/user/u_123"])
entries = client.memory.list(grants=["app/user/u_123"], limit=20)

client.memory.correct(
    ["app/user/u_123"],
    entry_id,
    "Prefers email receipts",
)
client.memory.delete_entry(["app/user/u_123"], entry_id)
\`\`\`

## Datasets and evals

The hosted client manages eval definitions, datasets, async eval runs, cancellation, and latest score queries.

\`\`\`ts {group=client-evals}
await client.datasets.create(dataset);
await client.evals.create(definition);

const run = await client.evals.run({
  evalId: "support-quality",
  datasetId: "refund-cases",
  agentVersion: "2026-06-18T15:30:00.000Z",
});

await client.evals.cancelRun(run.id);

const scores = await client.evals.listLatestScores({
  evalId: "support-quality",
});
\`\`\`

\`\`\`python {group=client-evals}
client.datasets.create(dataset)
client.evals.create(definition)

run = client.evals.run(
    eval_id="support-quality",
    dataset_id="refund-cases",
    agent_version="2026-06-18T15:30:00.000Z",
)

client.evals.cancel_run(run.id)
scores = client.evals.list_latest_scores(eval_id="support-quality")
\`\`\`

## Errors

\`\`\`ts {group=client-errors}
import { AuthenticationError, NotFoundError, RateLimitError } from "@agntz/client";

try {
  await client.agents.run({ agentId: "unknown", input: {} });
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — unknown agent id
  }
  if (err instanceof RateLimitError) {
    // 429 — back off
  }
}
\`\`\`

\`\`\`python {group=client-errors}
from agntz import AuthenticationError, NotFoundError

try:
    client.agents.run(agent_id="unknown", input={})
except NotFoundError:
    # 404 — unknown agent id
    pass
except AuthenticationError:
    # 401 — invalid or revoked API key
    pass
\`\`\`

## Authentication

External clients send \`Authorization: Bearer ar_live_...\`. Keys are issued in **Settings → API Keys** on \`agntz.co\` or your self-hosted UI. For browser usage, never embed an \`ar_live_*\` key client-side; proxy through your own backend and inject the key server-side.

## Self-host with the same client

The hosted client works against any Agntz worker — the public \`api.agntz.co\` or your own deployment.

\`\`\`ts {group=client-self-host}
const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://agntz-worker.mycompany.com",
});
\`\`\`

\`\`\`python {group=client-self-host}
client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://agntz-worker.mycompany.com",
)
\`\`\`
`;
