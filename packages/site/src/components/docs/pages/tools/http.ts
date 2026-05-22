export default `# HTTP tools

A single HTTP endpoint exposed to the model as a tool. URL placeholders define the LLM-facing parameter schema. \`GET\`, \`POST\`, \`PUT\`, \`PATCH\`, and \`DELETE\` are all supported. Works identically in embedded and hosted mode.

\`\`\`yaml
tools:
  - kind: http
    name: weather_lookup
    url: "https://api.weather.com/v1/forecast/{location}{?units}"
    description: "Look up weather forecast for a location"
    params:
      units: "metric"           # pin the optional query param; hidden from the LLM
    headers:
      Authorization: "Bearer {{secrets.WEATHER_TOKEN}}"
\`\`\`

## URL placeholder syntax

The URL template encodes the tool's parameter schema:

| Syntax | Meaning |
|---|---|
| \`{X}\` | Required path or query parameter |
| \`{X?}\` | Optional query parameter |
| \`{?units}\` | Required query (alt form) |
| \`{?units&format}\` | Multiple required query params |

Each placeholder becomes a parameter the model sees. The placeholder name is the parameter name; the type defaults to string. Use \`params:\` to **pin** a value — the parameter disappears from the model's tool schema and is filled by the template engine instead.

Headers are templated too — they can reference env vars (\`{{env.NAME}}\` in embedded mode) or secrets (\`{{secrets.NAME}}\` in hosted mode). See [Templates and conditions](/docs/schema/templates-conditions#special-namespaces).

## POST / PUT / PATCH with a request body

\`\`\`yaml
tools:
  - kind: http
    name: create_user
    url: "https://api.example.com/users"
    method: POST
    body_type: json            # json (default), form, or query
    body:
      name: "{{userName}}"
      email: "{{userEmail}}"
\`\`\`

\`body_type\`:

- \`json\` *(default)* — serializes \`body\` as JSON, sets \`Content-Type: application/json\`.
- \`form\` — URL-encoded form body.
- \`query\` — appends \`body\` properties to the URL's query string (useful when the only "body" you want is on a GET-like request that has many params).

Body fields can be templates (\`{{userName}}\`) or pinned literals. Templated fields the LLM provides go in the body; literals don't appear in the model's parameter schema.

## Dynamic auth — OAuth2 client credentials

For APIs that require fetching a short-lived access token before each call, declare an \`auth:\` block. The runner fetches the token, caches it (refreshes on 401), and applies it — no code required.

\`\`\`yaml
tools:
  - kind: http
    name: send_message
    url: "https://api.salesforce.com/services/data/v60.0/sobjects/Message"
    method: POST
    body_type: json
    body: { content: "{{message}}" }
    auth:
      type: oauth2_client_credentials
      token_url: "https://login.salesforce.com/services/oauth2/token"
      client_id: "{{secrets.SF_CLIENT_ID}}"
      client_secret: "{{secrets.SF_CLIENT_SECRET}}"
      scope: "messages:write"          # optional
      creds_location: basic_header     # default (RFC 6749); or "body"
\`\`\`

## Dynamic auth — generic token exchange

For login endpoints that don't match the OAuth2 spec — different field names, plain-text token responses, custom header names — use the parametric \`token_exchange\` form:

\`\`\`yaml
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
          username: "{{secrets.API_USER}}"
          password: "{{secrets.API_PASS}}"
      extract:
        response_format: json          # default; "text" for raw-body tokens
        token_path: "$.access_token"   # JSONPath; e.g. "$.token", "$.data.accessToken"
        expires_path: "$.expires_in"   # optional, seconds
      apply:
        location: header               # default; or "query"
        name: Authorization
        format: "Bearer {token}"       # default for header; "{token}" for query
      cache_ttl: 3000                  # optional, seconds
      refresh_on: [401]                # default
\`\`\`

## What you get for free

When you declare \`auth:\`, the runner provides:

- **Per-tenant token caching** keyed by ownerId — tokens are not shared across users.
- **Single-flight dedup** of concurrent token requests — only one fetch when many tools need the same token.
- **Automatic refresh-on-401** with one retry, no infinite loops.
- **Redaction of known token / secret substrings** from response bodies and error messages — tokens never leak into traces.

## Static auth

For APIs with long-lived keys, skip \`auth:\` and template the credential directly into headers:

\`\`\`yaml
tools:
  - kind: http
    name: openai_completions
    url: "https://api.openai.com/v1/chat/completions"
    method: POST
    headers:
      Authorization: "Bearer {{secrets.OPENAI_KEY}}"
    body_type: json
    body:
      model: "gpt-5.4"
      messages: "{{messages}}"
\`\`\`

## Failures

HTTP tool failures are captured in the \`tool.execute\` span. The model sees the error body (truncated, redacted) and can decide whether to retry or give up. Non-2xx responses are treated as errors by default.
`;
