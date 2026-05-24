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
