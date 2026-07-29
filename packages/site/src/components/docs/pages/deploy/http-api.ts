export default `# HTTP API reference

The hosted client wraps the worker HTTP API. You can call the API directly from trusted server-side code, or point \`@agntz/client\` / Python \`AgntzClient\` at your own worker.

## Endpoint groups

### Health and authoring

| Method | Path | Auth | Description |
|---|---|---|---|
| \`GET\` | \`/health\` | none | Liveness probe |
| \`POST\` | \`/build-agent\` | none | Public agent-builder endpoint used by \`agntz create\` |
| \`POST\` | \`/edit-agent\` | required | Edit an existing manifest from instructions |
| \`POST\` | \`/validate\` | required | Validate a manifest before saving or publishing |

### Agents and sessions

| Method | Path | Auth | Description |
|---|---|---|---|
| \`GET\` | \`/agents\` | required | List agents visible to the caller |
| \`GET\` | \`/agents/:id\` | required | Fetch an agent definition |
| \`POST\` | \`/agents/import\` | required | Import one or more local manifests into hosted storage |
| \`GET\` | \`/sessions\` | required | List sessions |
| \`GET\` | \`/sessions/:id\` | required | Fetch a session and messages |
| \`POST\` | \`/sessions/import\` | required | Import persisted local sessions |
| \`DELETE\` | \`/sessions/:id\` | required | Delete a hosted session |

Some self-hosted app/server deployments also expose create/update/delete agent routes and version/alias administration. The public clients use the import and run surfaces first, so those are the portable routes.

### Managed artifacts

| Method | Path | Auth | Description |
|---|---|---|---|
| \`POST\` | \`/artifacts\` | required | Multipart upload; fields \`file\`, \`purpose\`, and optional \`expiresInSeconds\` |
| \`GET\` | \`/artifacts/:id\` | required | Tenant-scoped metadata and signed download URL |
| \`GET\` | \`/artifacts/:id/content\` | required | Authenticated binary download |
| \`DELETE\` | \`/artifacts/:id\` | required | Delete metadata and bytes |
| \`GET\` | \`/artifact-download/:id\` | signed query | Short-lived signed binary download |

Uploads are limited to 50 MiB. The public clients automatically upload local
files and replace them with \`artifactId\` content blocks.

### Runs and streams

| Method | Path | Auth | Description |
|---|---|---|---|
| \`POST\` | \`/run\` | required | Execute an agent and return final output + state |
| \`POST\` | \`/run/block\` | required | Blocking run alias used by compatibility clients |
| \`POST\` | \`/run/stream\` | required | Execute an agent as Server-Sent Events |
| \`POST\` | \`/run/block/stream\` | required | Blocking stream alias used by compatibility clients |
| \`POST\` | \`/runs\` | required | Start an async run and return its handle |
| \`GET\` | \`/runs\` | required | List runs |
| \`GET\` | \`/runs/:id\` | required | Fetch current state of a run |
| \`POST\` | \`/runs/:id/cancel\` | required | Cancel a run and cascade to descendants |
| \`GET\` | \`/runs/:id/stream\` | required | Multiplexed event stream for a run subtree |

### Traces

| Method | Path | Auth | Description |
|---|---|---|---|
| \`GET\` | \`/traces\` | required | List traces |
| \`GET\` | \`/traces/:id\` | required | Trace detail with spans |
| \`GET\` | \`/traces/:id/stream\` | required | Live trace events while running |
| \`DELETE\` | \`/traces/:id\` | required | Delete a trace |

### Memory and namespace roots

| Method | Path | Auth | Description |
|---|---|---|---|
| \`POST\` | \`/memory/import\` | required | Import raw memory entries from a local memrez store |
| \`GET\` | \`/memory/topics\` | required | Scan memory topics visible to grants |
| \`GET\` | \`/memory/entries\` | required | List memory entries visible to grants |
| \`DELETE\` | \`/memory/entries/:id\` | required | Delete a memory entry |
| \`POST\` | \`/memory/entries/:id/correct\` | required | Correct an entry and supersede the previous value |
| \`POST\` | \`/memory/curate\` | required | Run memrez curation for granted scopes |
| \`POST\` | \`/scopes/delete\` | required | Cascade-delete a granted namespace scope |
| \`GET\` | \`/namespace-roots\` | required | List tenant namespace roots where exposed by the app/server |
| \`POST\` | \`/namespace-roots\` | required | Add a tenant namespace root |
| \`DELETE\` | \`/namespace-roots/:root\` | required | Remove a tenant namespace root |

Namespace-root administration is app/server owned. The worker enforces bounded grants when roots are available, and self-hosted deployments decide which admin route shape they expose.

### Datasets and evals

| Method | Path | Auth | Description |
|---|---|---|---|
| \`GET\` | \`/datasets\` | required | List datasets |
| \`POST\` | \`/datasets\` | required | Create or update a dataset |
| \`GET\` | \`/datasets/:id\` | required | Fetch dataset detail |
| \`PUT\` | \`/datasets/:id\` | required | Update dataset |
| \`DELETE\` | \`/datasets/:id\` | required | Delete dataset |
| \`GET\` | \`/evals\` | required | List eval definitions |
| \`POST\` | \`/evals\` | required | Create or update an eval definition |
| \`GET\` | \`/evals/:id\` | required | Fetch eval detail |
| \`PUT\` | \`/evals/:id\` | required | Update eval definition |
| \`DELETE\` | \`/evals/:id\` | required | Delete eval definition |
| \`POST\` | \`/eval-runs\` | required | Start an eval run |
| \`GET\` | \`/eval-runs\` | required | List eval runs |
| \`GET\` | \`/eval-runs/:id\` | required | Fetch eval run detail |
| \`POST\` | \`/eval-runs/:id/cancel\` | required | Cancel an eval run |
| \`GET\` | \`/eval-scores/latest\` | required | Latest scores by agent/eval/dataset/version |
| \`GET\` | \`/eval-scores\` | required | Score history |

### System agents and webhooks

| Method | Path | Auth | Description |
|---|---|---|---|
| \`GET\` | \`/system/agents\` | required | List bundled system agents |
| \`GET\` | \`/system/agents/:id\` | required | Fetch a bundled system agent |
| \`GET\` | \`/webhook-secrets\` | required | List webhook secrets |
| \`POST\` | \`/webhook-secrets\` | required | Create or rotate a webhook secret |
| \`DELETE\` | \`/webhook-secrets/:name\` | required | Delete a webhook secret |

## Authentication

The worker accepts two auth modes.

### External bearer token

\`\`\`
Authorization: Bearer ar_live_<token>
\`\`\`

The worker hashes the key, looks it up in the API-key store, resolves the tenant, and bounds namespace grants to that tenant's roots. This is what hosted clients send.

### Internal app-to-worker secret

\`\`\`
X-Internal-Secret: <WORKER_INTERNAL_SECRET>
\`\`\`

The product app uses this when calling the worker for a signed-in user. Current deployments sign and forward tenant context rather than trusting browser-provided tenant data. Do not expose this secret to clients.

## Run request shape

\`\`\`json
{
  "agentId": "support",
  "input": { "customerId": "cus_123" },
  "content": [
    { "type": "text", "text": "Explain this invoice" },
    {
      "type": "image",
      "artifactId": "artifact_...",
      "mediaType": "image/png",
      "detail": "high"
    }
  ],
  "sessionId": "optional-session-id",
  "context": ["app/user/u_123"],
  "retention": {
    "mode": "result",
    "ttlSeconds": 86400,
    "artifactTtlSeconds": 3600
  }
}
\`\`\`

\`input\` accepts a plain string, an object matching the agent schema, or rich
content for compatibility. Prefer the independent ordered \`content\` array for
text/image/audio messages. Content sources are \`url\`, \`base64\`,
\`artifactId\`, or client-only \`file\`; raw HTTP callers cannot send a local
file path.

\`context\` is a namespace grant array minted by trusted server-side code and
passed to resource providers such as memory. \`retention\` defaults to the
manifest policy or \`session\`. A caller can tighten a manifest default but
cannot loosen it. \`none\` is synchronous-only.

Run endpoints accept the same core fields. Async runs also accept callback and webhook fields when webhook delivery is configured.

The active manifest kind selects ordinary LLM execution, transcription, image
generation, or a composed workflow. No provider-specific route is required.

## Run response shape

\`\`\`json
{
  "output": { "answer": "..." },
  "state": {},
  "runId": "run_...",
  "traceId": "trace_...",
  "sessionId": "session_...",
  "status": "completed",
  "requestedAgentVersion": "production",
  "resolvedAgentVersion": "2026-07-28T18:30:00.000Z",
  "provider": "openai",
  "model": "gpt-5.4-2026-07-15",
  "usage": {
    "inputTokens": 412,
    "outputTokens": 87,
    "totalTokens": 499
  },
  "finishReason": "stop",
  "responseId": "resp_...",
  "warnings": [],
  "retention": { "mode": "session" }
}
\`\`\`

\`traceId\` and \`sessionId\` are omitted for \`none\` and \`result\`
retention. \`runId\` remains a correlation id even when no durable run record is
created. See [Results, streaming, and errors](/docs/hosted/results-errors).

## Stream format

\`/run/stream\`, \`/runs/:id/stream\`, and \`/traces/:id/stream\` emit Server-Sent Events.

\`\`\`
event: stream
data: {"type": "text-delta", "text": "Hello"}

event: stream
data: {"type": "complete", "output": "Hello, world!", "state": {...}}
\`\`\`

Reconnect with \`Last-Event-ID\` or \`?since=<seq>\` where supported. Servers may send keepalive comments to avoid proxy idle timeouts.

## Errors

The worker returns JSON error bodies with stable codes:

\`\`\`json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "No agent with id 'unknown'",
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
| 429 | \`RATE_LIMITED\` |
| 500 | \`INTERNAL\` |

The clients map these to typed errors. See [Hosted client → Errors](/docs/sdk-cli/client#errors).
`;
