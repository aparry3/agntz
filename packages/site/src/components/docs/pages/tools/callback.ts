export default `# Signed callback tools

Callback tools let a hosted model call application-owned business logic without
moving authorization, database access, or domain code into Agntz. The manifest
declares only the model-visible input contract; Agntz injects trusted runtime
context and signs the complete request.

## Manifest

\`\`\`yaml [agents/hosted-nutritionist.yaml]
id: hosted-nutritionist
kind: llm

model:
  provider: openai
  name: gpt-5.6-sol

instruction: |
  Help the user find recipes. Call find_recipes when application data is needed.

tools:
  - kind: callback
    name: find_recipes
    description: Search recipes visible to the current trusted user.
    url: https://api.example.com/agntz/tools/find-recipes
    secret: nutritext_callback
    timeoutMs: 10000
    maxRetries: 2
    inputSchema:
      type: object
      properties:
        query: { type: string }
        savedOnly: { type: boolean }
        limit:
          type: integer
          minimum: 1
          maximum: 20
      required: [query]
      additionalProperties: false
\`\`\`

\`inputSchema\` must be a canonical object-root JSON Schema. Agntz presents that
exact schema to the model and validates the tool arguments before delivery.
\`secret\` names an owner-scoped secret configured in the hosted workspace or
self-hosted \`SecretStore\`; the secret value never appears in the manifest.

Timeouts are clamped to 1–120 seconds. Retries are clamped to 0–5. Agntz retries
network failures, 408, 429, and 5xx responses with a short exponential delay.

## Request body

\`\`\`json
{
  "tool": "find_recipes",
  "args": {
    "query": "quick tomato pasta",
    "savedOnly": true,
    "limit": 10
  },
  "runtime": {
    "sessionId": "session_...",
    "runId": "run_...",
    "agentId": "hosted-nutritionist"
  },
  "delivery": {
    "id": "cbd_...",
    "timestamp": "2026-07-28T18:30:00.000Z"
  }
}
\`\`\`

\`runtime\` is injected from the active invocation. The model cannot choose a
user id, namespace grant, run id, session id, or trusted application identity.
Your endpoint should resolve authorization from the signed runtime context and
its own application data.

## Signature headers

| Header | Value |
|---|---|
| \`X-Agntz-Signature\` | \`sha256=<hex HMAC>\` |
| \`X-Agntz-Timestamp\` | ISO timestamp from the delivery body |
| \`X-Agntz-Delivery-Id\` | Stable delivery id |
| \`Idempotency-Key\` | Same stable delivery id |

The signed bytes are:

\`\`\`text
timestamp + "." + deliveryId + "." + rawRequestBody
\`\`\`

Verify the signature against the raw request body before parsing JSON. Then
reject stale timestamps and deduplicate the delivery id.

\`\`\`ts [verify-callback.ts]
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyCallback(
  secret: string,
  timestamp: string,
  deliveryId: string,
  rawBody: string,
  received: string,
) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(timestamp + "." + deliveryId + "." + rawBody)
    .digest("hex");

  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
\`\`\`

The body, timestamp, signature, and delivery id remain identical across retry
attempts. Store the delivery id with the completed response so a retry cannot
repeat a database mutation.

## Endpoint response

Return a 2xx response with JSON when possible. The parsed JSON becomes the tool
result visible to the model; a non-JSON success body is returned as text.
Response bodies are capped before they are returned to the model.

Return a non-retryable 4xx response for invalid arguments or forbidden work.
Use 408, 429, or 5xx only when retrying the same idempotency key is safe.

## Security checklist

- Require HTTPS outside trusted local development.
- Verify HMAC using the raw body and constant-time comparison.
- Enforce a timestamp tolerance.
- Deduplicate \`X-Agntz-Delivery-Id\`.
- Derive the authorized application principal server-side.
- Treat \`args\` as untrusted even though it passed JSON Schema.
- Keep callback responses small and free of secrets.
- Allowlist callback destinations in the worker outbound URL policy.

Callback tools are different from async run-completion webhooks. A callback
tool is invoked by the model during a run and its result feeds the model loop.
A run webhook is configured by trusted application code when starting a durable
run and reports lifecycle completion.
`;
