# agntz YAML Schema Reference

This document describes the complete YAML schema for defining agents. Use it to create valid agent manifests.

## Agent Kinds

There are four kinds of agents:

- `llm` — calls a language model
- `tool` — deterministic function call (no LLM)
- `sequential` — runs steps in order (optionally loops)
- `parallel` — runs branches simultaneously

## Common Fields

Every agent must have:

```yaml
id: my-agent          # required, unique identifier (even for inline agents)
kind: llm             # required: llm | tool | sequential | parallel
name: My Agent        # optional display name
description: ...      # optional
```

## Input Schema

Declares what input the agent expects. All properties are required but nullable.

```yaml
# Simple types
inputSchema:
  query: string
  count: number
  active: boolean

# With constraints
inputSchema:
  language:
    type: string
    default: en
    enum: [en, es, fr]
  temperature:
    type: number
    min: 0
    max: 1
```

If `inputSchema` is omitted, the agent takes a plain string accessible as `{{userQuery}}`.

## State and encapsulation

Every agent owns a private state. Parents cannot read child state, and children cannot read parent state. The only ways data crosses a boundary are:

- **`input:`** on a step — a transform that maps parent state → child input
- **`outputSchema`** / **`output:`** — what the child exposes back to its parent

### State shape

An agent's state is built from its `input` and grows as steps run:

```
{ ...input, [stepStateKey]: stepOutput, ... }
```

`input` is shaped by the agent's `inputSchema`. Each step writes its output back to the parent's state under its `stateKey`.

Templates inside an agent (`instruction`, `tool.params`, `input:` transforms, `output:` mappings, `when`, `until`) are evaluated against **that agent's state only** — never against a child's or parent's.

### Mental model: input is the output of some upstream agent

Every agent's input comes from an upstream producer. The default upstream depends on where the agent sits:

| Position                               | Default upstream                              |
| -------------------------------------- | --------------------------------------------- |
| First step of a sequential or parallel | The parent agent's input                      |
| Subsequent step of a sequential        | The previous step's output                    |
| First step of a loop, iteration N>1    | The last step's output from iteration N-1     |

If the default isn't what the child needs, add an explicit `input:` transform on the step. Each value in `input:` is a template evaluated against the **parent's** state (so the parent decides what to expose).

### `input:` lives on the step; `inputSchema` lives on the agent

`input:` is a step-level transform — a sibling of `agent:` / `ref:`. `inputSchema` belongs to the child agent itself. The transform's keys must equal the child's `inputSchema` keys exactly.

```yaml
# Inline child
- agent:
    id: summarizer
    kind: llm
    inputSchema:
      text: string                       # child declares what it consumes
      style: string
    model: { provider: openai, name: gpt-5.4 }
    instruction: "Summarize {{text}} in {{style}} style"
  input:                                  # step-level: parent → child
    text: "{{researcher.findings}}"
    style: "{{userStyle}}"

# Referenced child — same rule, the ref'd agent declares its own inputSchema
- ref: summarizer
  input:
    text: "{{researcher.findings}}"
    style: "{{userStyle}}"
```

### Loop semantics

Inside a loop (`until:`), every step's output is part of the loop's state from the very first iteration. References to steps that haven't run yet (or to the loop's own previous-iteration outputs) resolve to `null` until populated. This is what makes the generate-and-validate pattern work:

```yaml
until: "{{validator.valid}} == true"
maxIterations: 3
steps:
  - agent:
      id: generator
      kind: llm
      inputSchema:
        topic: string
        errors: object       # null on iteration 1
        previousYaml: string # null on iteration 1
      # ...
    input:
      topic: "{{topic}}"
      errors: "{{validator.errors}}"      # validator hasn't run on iter 1 → null
      previousYaml: "{{generator.yaml}}"  # self-ref from previous iter → null on iter 1
  - agent:
      id: validator
      # ...
    input:
      yaml: "{{generator.yaml}}"
```

### Strict validation

The validator enforces encapsulation:

- A template ref to a name not in the agent's state is an **error**, not a warning.
- A step's `input:` keys must equal the child's `inputSchema` keys (extra keys, missing keys → error).
- A step with no `input:` is only valid if the default upstream's output keys cover the child's `inputSchema`.

### stateKey

Override where a step's output lands in the parent's state (and how templates reference it):

```yaml
steps:
  - ref: my-agent
    stateKey: result    # access as {{result}} instead of {{myAgent}}
```

## Template Syntax

Used in `instruction`, `input` transforms, `output` mappings, tool `params`.

### Variable interpolation

```yaml
instruction: "Answer: {{userQuery}}"
```

Null values render as empty string. Objects render as JSON.

### Conditional blocks

```yaml
instruction: |
  {{#if feedback}}
  Previous feedback: {{feedback}}
  {{/if}}

  {{#if language != en}}
  Respond in {{language}}.
  {{/if}}
```

Supports: `{{#if var}}` (truthiness), `{{#if var == value}}`, `{{#if var != value}}`.

## LLM Agent

```yaml
id: sentiment-analyzer
kind: llm

inputSchema:
  text: string

model:
  provider: openai        # openai | anthropic | google | mistral
  name: gpt-5.4
  temperature: 0.7        # optional (0-2)
  maxTokens: 4096         # optional
  topP: 1.0               # optional

instruction: |
  Analyze the sentiment of: {{text}}

# Optional: few-shot examples
examples:
  - input: "I love this!"
    output: "positive"

# Optional: enforce structured JSON output
outputSchema:
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number

# Optional: tools available to the LLM.
# Four kinds — mcp / http / local / agent. Mix freely in one array.
tools:
  # MCP server — one or more tools from a remote MCP endpoint.
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:                       # omit to expose every tool the server offers
      - search                   # plain — passes through as-is
      - tool: fetch              # wrapped — see "Tool wrapping" below
        name: fetch_for_user
        description: "Fetch URL"
        params:
          api_key: "{{apiKey}}"

  # HTTP endpoint — one URL as one tool. See "HTTP tools" below.
  - kind: http
    name: weather_lookup
    url: "https://api.example.com/v1/forecast/{location}{?units}"
    method: GET
    headers:
      Authorization: "Bearer {{secrets.WEATHER_TOKEN}}"

  # Local tools registered with the runner/worker by name.
  - kind: local
    tools: [calculator]

  # Another agent exposed as a callable tool.
  - kind: agent
    agent: helper-agent
```

### Tool wrapping (MCP)

Pin parameters from state. The LLM sees a modified schema without the pinned params:

```yaml
tools:
  - kind: mcp
    server: https://api.example.com/mcp
    tools:
      - plain_tool                   # as-is
      - tool: search                 # original name (must match server)
        name: search_current_user    # optional: LLM sees this name
        description: "Search by query"  # optional: LLM sees this
        params:
          user_id: "{{userId}}"      # pinned, removed from LLM schema
```

### HTTP tools

A single HTTP endpoint exposed to the model as one tool. The LLM sees `http__<name>`.

**URL placeholders** in `url:` derive the LLM-facing parameter schema:
- `{X}` — required (path or query)
- `{X?}` — optional (query only)

```yaml
- kind: http
  name: list_repos
  url: "https://api.github.com/users/{username}/repos{?sort,per_page?}"
  method: GET                       # default GET; also POST / PUT / PATCH / DELETE
  description: "List public repos for a user"
  headers:
    Authorization: "Bearer {{secrets.GITHUB_TOKEN}}"
```

- **`params:`** — pin placeholders to state templates (same convention as MCP wrapping). Pinned keys are removed from the LLM schema.
- **`headers:`** — values are state-templated. Reference credentials via `{{secrets.NAME}}` (host SecretStore) or `{{env.NAME}}` (process env).
- **Body methods** (`POST`/`PUT`/`PATCH`/`DELETE`): set `body_type` (`json` default; also `form` or `query`) and a templated `body:` map.

```yaml
- kind: http
  name: create_issue
  url: "https://api.example.com/issues"
  method: POST
  body_type: json
  body:
    title: "{{issueTitle}}"
    body: "{{issueBody}}"
  headers:
    Authorization: "Bearer {{secrets.API_TOKEN}}"
```

### HTTP authentication

Static credentials (Bearer / Basic / API key) go in `headers:` via `{{secrets.X}}`. Dynamic credentials — anything that requires fetching a token first — go in an `auth:` block on the HTTP tool. The runner fetches, caches, and refreshes-on-401 automatically.

**`oauth2_client_credentials`** — RFC 6749 §4.4 client-credentials grant. Use when the user mentions "client id + client secret", "OAuth2 client credentials", or "M2M / service-to-service auth":

```yaml
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
    client_id: "{{secrets.SF_CLIENT_ID}}"
    client_secret: "{{secrets.SF_CLIENT_SECRET}}"
    scope: "messages:write"           # optional
    creds_location: basic_header      # default; or "body"
    cache_ttl: 3000                   # optional, seconds
    refresh_on: [401]                 # default
```

**`token_exchange`** — fully parametric. Use when the user describes a custom login endpoint, non-standard token field name, or username+password exchange:

```yaml
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
      response_format: json           # default; or "text" for raw-body tokens
      token_path: "$.access_token"    # JSONPath; e.g. "$.token", "$.data.accessToken"
      expires_path: "$.expires_in"    # optional, seconds
    apply:
      location: header                # default; or "query"
      name: Authorization
      format: "Bearer {token}"        # default for header; "{token}" for query
```

**Choosing an auth shape:**

| User says…                                                  | Use                            |
| ----------------------------------------------------------- | ------------------------------ |
| "API key" / "Bearer token" / "I have a static token"        | header + `{{secrets.X}}`, no `auth:` block |
| "client id and client secret" / "OAuth2" / "service auth"   | `oauth2_client_credentials`    |
| "login with username+password and get a token" / custom token shape | `token_exchange`        |

### Choosing tool kind

- User describes an MCP server ("I have tools at &lt;mcp-url&gt;", "use the &lt;X&gt; and &lt;Y&gt; tools from &lt;server&gt;") → `kind: mcp` with that `server:` and the named tools.
- User describes one or more HTTP API endpoints ("fetch from /users/{id}", "POST to this URL", "this REST API") → one `kind: http` entry per endpoint.
- User names a tool that's been registered locally (calculator, date formatter, send_slack, etc.) → `kind: local`.
- User wants one agent to delegate to another → `kind: agent`.

Many real agents combine kinds — e.g. an MCP search server plus a couple of internal HTTP endpoints in the same `tools:` array.

## Tool Agent

Deterministic function call. No LLM involved. The `tool:` block accepts the same four kinds as an LLM's `tools:` array, but exactly one tool per agent.

```yaml
# MCP variant
id: send-email
kind: tool

inputSchema:
  to: string
  subject: string
  body: string

tool:
  kind: mcp
  server: https://email.example.com/mcp
  name: send_email
  params:
    to: "{{to}}"
    subject: "{{subject}}"
    body: "{{body}}"
```

```yaml
# HTTP variant — fully deterministic API call, no LLM
id: post-webhook
kind: tool

inputSchema:
  payload: object

tool:
  kind: http
  name: post_webhook
  url: "https://hooks.example.com/incoming"
  method: POST
  body_type: json
  body: "{{payload}}"
  headers:
    Authorization: "Bearer {{secrets.WEBHOOK_TOKEN}}"
```

## Sequential Agent

Runs steps in order. Each step's output is added to state.

```yaml
id: research-pipeline
kind: sequential

inputSchema:
  topic: string
  language:
    type: string
    default: en

steps:
  # Reference an existing agent by ID
  - ref: researcher
    input:
      query: "{{topic}}"

  # Inline agent definition
  - agent:
      id: summarizer
      kind: llm
      inputSchema:
        text: string
      model:
        provider: openai
        name: gpt-5.4
      instruction: "Summarize: {{text}}"
      outputSchema:
        summary: string
    input:
      text: "{{researcher}}"

  # Conditional step (skipped if false, output = null)
  - ref: translator
    when: "{{language}} != en"
    input:
      text: "{{summarizer.summary}}"

# Optional output mapping (defaults to last step's output)
output:
  result: "{{summarizer.summary}}"
  translation: "{{translator}}"
```

### Looping

Add `until` to loop steps until a condition is met:

```yaml
id: write-review-loop
kind: sequential

inputSchema:
  topic: string

until: "{{reviewer.approved}} == true"
maxIterations: 5

steps:
  - agent:
      id: writer
      kind: llm
      inputSchema:
        topic: string
        feedback: string
      model:
        provider: openai
        name: gpt-5.4
      instruction: |
        Write about {{topic}}.
        {{#if feedback}}
        Incorporate this feedback: {{feedback}}
        {{/if}}
      outputSchema:
        draft: string
    input:
      topic: "{{topic}}"
      feedback: "{{reviewer.feedback}}"

  - agent:
      id: reviewer
      kind: llm
      inputSchema:
        draft: string
      model:
        provider: openai
        name: gpt-5.4
        temperature: 0
      instruction: "Review this draft: {{draft}}"
      outputSchema:
        approved: boolean
        feedback: string
    input:
      draft: "{{writer.draft}}"
```

## Parallel Agent

Runs branches simultaneously. Default output: all branch outputs as an object.

```yaml
id: text-analysis
kind: parallel

inputSchema:
  text: string

branches:
  - ref: sentiment-analyzer
    input:
      text: "{{text}}"

  - agent:
      id: entity-extractor
      kind: llm
      inputSchema:
        text: string
      model:
        provider: openai
        name: gpt-5.4
      instruction: "Extract entities from: {{text}}"
      outputSchema:
        entities: string
    input:
      text: "{{text}}"

output:
  sentiment: "{{sentimentAnalyzer}}"
  entities: "{{entityExtractor}}"
```

## Step Reference

Steps use `ref` for existing agents or `agent` for inline definitions:

```yaml
# By reference
- ref: agent-id
  input:                          # map parent state to agent input
    paramX: "{{stateVar}}"
  stateKey: customKey             # override output key on parent state
  when: "{{condition}} == value"  # conditional execution

# Inline
- agent:
    id: my-inline-agent           # required even for inline
    kind: llm
    # ... full agent definition
  input:
    paramX: "{{stateVar}}"
  stateKey: customKey
  when: "{{condition}} == value"
```

## Conditions

Used in `when` (step-level) and `until` (sequential looping):

```yaml
when: "{{feedback}}"                    # truthiness (non-null, non-empty)
when: "{{language}} != en"              # inequality
until: "{{score}} >= 0.8"              # comparison
until: "{{approved}} == true && {{score}} >= 0.8"  # compound
```

Operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`

## Output

### LLM agents: `outputSchema`

Enforces structured JSON output from the model:

```yaml
outputSchema:
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number
```

### Pipeline agents: `output`

Maps state to output. Defaults to last step (sequential) or all branches (parallel):

```yaml
output:
  result: "{{summarizer.summary}}"
  sources:
    web: "{{webResearcher}}"
    academic: "{{academicResearcher}}"
```

## Rules

1. Every agent (including inline) must have an `id`
2. Steps must have either `ref` or `agent`, not both
3. All `inputSchema` properties are required but nullable
4. `until` and `maxIterations` only apply to sequential agents
5. Template `{{}}` references state. Two special namespaces are also available in tool `params`, HTTP `headers`/`body`/`url`, and `auth:` blocks: `{{secrets.NAME}}` (host SecretStore) and `{{env.NAME}}` (process env). Never use these in `instruction:` — they're for credential plumbing, not LLM context.
6. Skipped steps (via `when`) produce null output
7. Pipelines fail fast — any step failure stops the pipeline
8. `outputSchema` is for LLM structured output; `output` is for pipeline state mapping
