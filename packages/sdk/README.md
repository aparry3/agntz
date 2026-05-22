# @agntz/sdk

Official agntz SDK. Embedded in-process YAML agent runner — five lines of code, one YAML file, and you're running an AI agent. No server, no signup, no infrastructure.

When you outgrow embedded mode, swap one import line and the same code runs against the hosted [@agntz/client](https://www.npmjs.com/package/@agntz/client).

## Install

```bash
pnpm add @agntz/sdk
# or: npm install @agntz/sdk
# or: yarn add @agntz/sdk
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
import { agntz } from "@agntz/sdk";

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
import { agntz, tool, z } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tools: [
    tool({
      name: "add",
      description: "Add two numbers and return the sum",
      input: z.object({
        a: z.number().describe("First operand"),
        b: z.number().describe("Second operand"),
      }),
      execute: async ({ a, b }) => a + b,
    }),
  ],
});
```

Each tool is self-describing: the `name`, `description`, and Zod `input` schema all flow through to the model's tool list, so it knows when to call the tool and how to shape arguments. `z` is re-exported from `@agntz/sdk` — no separate `zod` install needed.

Names referenced in YAML but missing from the `tools` array fail at load time, not on first model call.

## HTTP tools with credentials

### Static credentials — templated headers

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

`{{secrets.NAME}}` works the same way when a `SecretStore` is wired (typically through `@agntz/store-sqlite`).

### POST / PUT / PATCH with a request body

HTTP tools support `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`. For methods that accept a body, set `body_type` (`json` is the default when `body` is present) and provide a templated `body`:

```yaml
tools:
  - kind: http
    name: create_user
    url: "https://api.example.com/users"
    method: POST
    body_type: json
    body:
      name: "{{userName}}"
      email: "{{userEmail}}"
```

`body_type: form` serializes the body as `application/x-www-form-urlencoded`; `body_type: query` appends the fields to the URL.

### Dynamic auth — OAuth2 client credentials

When an API requires fetching a short-lived access token before each request, declare an `auth:` block. The runner fetches the token, caches it (in-memory by default; refreshes on `401`), and applies it to every request — you don't need to write any code.

The `oauth2_client_credentials` preset covers the standard RFC 6749 §4.4 flow:

```yaml
tools:
  - kind: http
    name: send_message
    url: "https://api.salesforce.com/services/data/v60.0/sobjects/Message"
    method: POST
    body_type: json
    body:
      content: "{{message}}"
    auth:
      type: oauth2_client_credentials
      token_url: "https://login.salesforce.com/services/oauth2/token"
      client_id: "{{secrets.sf_client_id}}"
      client_secret: "{{secrets.sf_client_secret}}"
      scope: "messages:write"             # optional
      creds_location: basic_header        # default; or "body"
```

### Dynamic auth — generic token exchange

For login endpoints that don't match RFC 6749 (custom shapes, different field names, plain-text token bodies, etc.) use the parametric `token_exchange` form:

```yaml
tools:
  - kind: http
    name: list_things
    url: "https://api.example.com/things"
    auth:
      type: token_exchange
      request:
        url: "https://api.example.com/auth/login"
        method: POST
        body_type: json
        body:
          username: "{{secrets.api_user}}"
          password: "{{secrets.api_pass}}"
      extract:
        response_format: json             # default; or "text" for raw-body tokens
        token_path: "$.access_token"      # JSONPath; e.g. "$.token", "$.data.accessToken"
        expires_path: "$.expires_in"      # optional, seconds
      apply:
        location: header                  # default; or "query"
        name: Authorization               # header or query parameter name
        format: "Bearer {token}"          # default for header; "{token}" for query
      cache_ttl: 3000                     # optional, seconds (overrides expires_path)
      refresh_on: [401]                   # default; statuses that trigger refresh + retry
```

Every shape is configurable: `{access_token}`, `{token}`, `{data: {accessToken}}`, raw text bodies, headers vs query, "Bearer" prefix vs raw token. See the test fixtures in `packages/core/tests/auth/` for more examples.

### What you get for free

- **Token caching** per `(auth shape, ownerId)` so two tenants sharing the same OAuth app don't share a token.
- **Single-flight** dedup: a burst of N tool calls fires one token request, not N.
- **Refresh-on-401**: on `401` (configurable via `refresh_on`), the runner invalidates the cache and retries exactly once. A second `401` surfaces normally — no infinite loops.
- **Credential redaction**: known tokens and `state.secrets` values are scrubbed from response bodies and auth-error messages before they reach the LLM, traces, or logs.

### Persistent token cache (advanced)

The default in-memory cache is lost on process restart. To plug in a persistent backend (Redis, SQL, etc.), pass `tokenCache` when constructing the runner:

```ts
import { agntz } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tokenCache: myPersistentCache,  // any object implementing TokenCache
});
```

## Sessions

By default, sessions are in-memory and reset on process restart. For persistence, install `@agntz/store-sqlite` and use the `sqlite` subpath:

```bash
pnpm add @agntz/store-sqlite
```

```ts
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

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

When you outgrow embedded mode — multi-user isolation, durable run history, hosted observability, agent push from CI — swap to `@agntz/client`:

```diff
- import { agntz } from "@agntz/sdk";
+ import { AgntzClient } from "@agntz/client";

- const client = await agntz({ agents: "./agents", tools });
+ const client = new AgntzClient({ apiKey: process.env.AGNTZ_API_KEY!, baseUrl: "https://api.agntz.co" });
```

The `client.agents.run / .stream`, `client.runs.list / .get`, and `client.traces.list / .get` calls work identically. YAML manifests move to the hosted registry; local tool handlers don't graduate (those become hosted MCP servers or HTTP endpoints).

## What's supported in embedded mode

| Feature | Embedded | Hosted (@agntz/client) |
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
