export default `# Results, streaming, and errors

Hosted operations return one normalized envelope even when providers use
different response shapes. Application code can record model and usage metadata
without reaching into an OpenAI- or Anthropic-specific object.

## Synchronous result

\`\`\`ts
type RunResult = {
  output: unknown;
  state: Record<string, unknown>;
  runId: string;
  traceId?: string;
  sessionId?: string;
  status: "completed";
  requestedAgentVersion?: string;
  resolvedAgentVersion?: string;
  provider?: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
  responseId?: string;
  warnings?: string[];
  retention?: {
    mode?: "none" | "result" | "session";
    ttlSeconds?: number;
    artifactTtlSeconds?: number;
  };
};
\`\`\`

Python exposes the same fields with snake_case attributes:
\`result.run_id\`, \`result.trace_id\`, \`result.session_id\`,
\`result.requested_agent_version\`, \`result.resolved_agent_version\`,
\`result.finish_reason\`, and \`result.response_id\`.

\`runId\` exists for correlation even when \`retention.mode\` is \`none\`; it
does not imply a durable record. \`traceId\` and \`sessionId\` are present only
when the retention policy creates those records.

## Structured output failures

Canonical output schemas are passed to providers that support structured
generation and are also validated by Agntz. A response that cannot satisfy the
declared contract fails with a structured schema error instead of silently
returning malformed application data.

Manifest validation errors include JSON Pointer paths. Client errors preserve
the worker's stable \`code\`, HTTP status, message, and request details when
available.

## Streaming

\`agents.stream\` uses Server-Sent Events and yields a \`start\` event followed
by operation events and exactly one terminal \`complete\` or \`error\` event.

\`\`\`ts {group=normalized-stream}
for await (const event of client.agents.stream({
  agentId: "support",
  input: "Explain my invoice",
  retention: { mode: "session" },
})) {
  if (event.type === "start") {
    console.log(event.kind, event.runId, event.traceId, event.sessionId);
  }
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "reply") console.log("reply", event.text);
  if (event.type === "complete") console.log(event.output);
  if (event.type === "error") console.error(event.error);
}
\`\`\`

\`\`\`python {group=normalized-stream}
for event in client.agents.stream(
    agent_id="support",
    input="Explain my invoice",
    retention={"mode": "session"},
):
    if event.type == "start":
        print(event.run_id, event.trace_id, event.session_id)
    elif event.type == "complete":
        print(event.output)
    elif event.type == "error":
        print(event.error)
\`\`\`

Breaking out of the iterator closes the HTTP response. Pass an
\`AbortSignal\` in TypeScript or close the Python iterator/client when the
calling job is cancelled.

## Durable asynchronous runs

Use \`agents.start\` or \`runs.start\` when work must continue independently of
the request connection.

\`\`\`ts
const run = await client.agents.start({
  agentId: "large-enrichment",
  input: batch,
  retention: { mode: "result", ttlSeconds: 86_400 },
});

const current = await client.runs.get(run.id);
await client.runs.cancel(run.id);
\`\`\`

Durable starts reject \`retention.mode: none\`. Run streams can reconnect with
a sequence cursor where supported.

## Error classes

\`\`\`ts
import {
  AgntzError,
  AuthenticationError,
  NotFoundError,
  StreamError,
} from "@agntz/client";

try {
  await client.agents.run({ agentId: "missing", input: {} });
} catch (error) {
  if (error instanceof AgntzError) {
    console.error(error.code, error.status, error.message);
  }
}
\`\`\`

\`\`\`python
from agntz import AgntzError, AuthenticationError, NotFoundError

try:
    client.agents.run(agent_id="missing", input={})
except AgntzError as error:
    print(error.code, error.status, str(error))
\`\`\`

Common error families include authentication, unknown agents or artifacts,
manifest and input schema validation, forbidden retention changes, cancelled
runs, outbound URL rejection, provider failures, and rate limits. Treat
\`code\` as the machine-readable discriminator and \`message\` as diagnostic
text.

Provider warnings and finish reasons are data, not exceptions. Store them with
the resolved agent version when they matter to quality or billing analysis.
`;
