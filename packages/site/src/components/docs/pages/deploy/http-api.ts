export default `# HTTP API reference

The worker exposes a small HTTP surface. The SDK (\`@agntz/client\`) wraps it; you can also call it directly.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| \`GET\` | \`/health\` | none | Liveness probe |
| \`POST\` | \`/run\` | required | Execute an agent, return final output + state |
| \`POST\` | \`/run/stream\` | required | Same, as Server-Sent Events |
| \`POST\` | \`/runs\` | required | Start a run, return its handle immediately |
| \`GET\` | \`/runs/:id\` | required | Fetch current state of a run |
| \`POST\` | \`/runs/:id/cancel\` | required | Cancel a run and cascade to descendants |
| \`GET\` | \`/runs\` | required | List runs (filters: \`agentId\`, \`status\`, time range) |
| \`GET\` | \`/runs/:id/stream\` | required | Multiplexed event stream for a run subtree |
| \`GET\` | \`/traces\` | required | List traces |
| \`GET\` | \`/traces/:id\` | required | Trace detail with spans |
| \`GET\` | \`/traces/:id/stream\` | required | Live trace events while running |
| \`DELETE\` | \`/traces/:id\` | required | Delete a trace |
| \`POST\` | \`/build-agent\` | none | Public agent-builder endpoint used by \`agntz create\` |

## Authentication

The worker accepts two auth modes:

### External — Bearer token

\`\`\`
Authorization: Bearer ar_live_<token>
\`\`\`

The worker sha256-hashes the key on receipt, looks it up in the API keys table, and resolves the request to a user id. This is what \`@agntz/client\` sends.

### Internal — shared secret + userId

\`\`\`
X-Internal-Secret: <WORKER_INTERNAL_SECRET>
\`\`\`

Used by the app calling the worker on behalf of a signed-in user. The body must include \`userId\` (the Clerk user id):

\`\`\`json
{
  "userId": "user_abc...",
  "agentId": "my-agent",
  "input": { "message": "Hello" }
}
\`\`\`

Don't expose this secret to clients — it's app-to-worker only.

## Request shape

\`\`\`json
{
  "userId": "user_abc...",        // required with internal auth; ignored with Bearer
  "agentId": "my-agent",
  "input": { "message": "Hello" },
  "sessionId": "optional-session-id",
  "context": ["app/user/u_123"]
}
\`\`\`

\`input\` accepts either a plain string (when the agent has no \`inputSchema\`) or an object matching the agent's schema.

\`context\` is optional. When present, it is a namespace grant array passed to resource providers such as memory. Mint it from trusted server-side state, such as the authenticated user or workspace. Do not ask the model or a browser client to choose grants.

\`/run\`, \`/run/stream\`, and \`/runs\` all accept the same \`agentId\`, \`input\`, \`sessionId\`, and \`context\` fields. \`/runs\` also accepts webhook fields such as \`callbackUrl\` and \`webhookSecretName\`.

## Stream format (SSE)

\`/run/stream\`, \`/runs/:id/stream\`, and \`/traces/:id/stream\` emit Server-Sent Events.

\`\`\`
event: stream
data: {"type": "text-delta", "text": "Hello"}

event: stream
data: {"type": "complete", "output": "Hello, world!", "state": {...}}
\`\`\`

Reconnect with the \`Last-Event-ID\` header (or \`?since=<seq>\` for the multiplexed run stream) to resume from where you left off. Servers may send \`:keepalive\` comments every 15s to defeat proxy idle timeouts.

## System agents

Invoke a system agent — bundled with the worker, not user-defined — by prefixing the id with \`system:\`:

\`\`\`json
{ "agentId": "system:agent-builder", "input": { "description": "..." } }
\`\`\`

The default \`agent-builder\` powers the UI's "Create from description" feature and the CLI's \`agntz create\` command. System agents bypass the user's store and run with ephemeral in-memory state.

## Public endpoints

A couple of endpoints are intentionally unauthenticated:

- \`GET /health\` — for load balancers and uptime checks.
- \`POST /build-agent\` — the public agent-builder, called by \`agntz create\` (no login). Rate-limited by IP.

Everything else requires an API key or the internal secret.

## Errors

The worker returns JSON error bodies with a stable \`code\`:

\`\`\`json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "No agent with id 'unknown' in workspace ws_xxx",
    "status": 404
  }
}
\`\`\`

| HTTP status | Common codes |
|---|---|
| 400 | \`INVALID_INPUT\`, \`SCHEMA_VALIDATION\` |
| 401 | \`AUTH_MISSING\`, \`AUTH_INVALID\` |
| 404 | \`AGENT_NOT_FOUND\`, \`RUN_NOT_FOUND\` |
| 409 | \`RUN_CANCELLED\` |
| 429 | \`RATE_LIMITED\` (includes \`Retry-After\` header) |
| 500 | \`INTERNAL\` |

The SDK maps these to typed errors (\`AuthenticationError\`, \`NotFoundError\`, \`RateLimitError\`, ...). See [@agntz/client → Errors](/docs/sdk-cli/client#errors).
`;
