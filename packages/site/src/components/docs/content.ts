// Single source of truth for the docs page.
// Rendered as React for humans at /docs; served as raw markdown at /llms.txt.
//
// Section structure: every `## Title` becomes a TOC entry. Slugs are derived
// from the heading text. Keep H2s human-readable — they're the navigation.

export const DOCS_MARKDOWN = `# agntz documentation

A complete guide to defining, running, and shipping AI agents with **agntz**.

agntz is an open-source agent framework where agents are declared as YAML — not code — and run unchanged in three places: embedded in your app (\`@agntz/sdk\`), on the hosted cloud (\`agntz.co\`), or on infrastructure you control (self-host). Every run is traced. Every save is a version. Bring your own model keys.

These docs are optimized for both humans and LLMs. The same markdown is served verbatim at [/llms.txt](/llms.txt) for AI tools and agents.

## What you can build

- **Single-call agents** — an LLM with an instruction, optional tools, optional structured output.
- **Pipelines** — sequential and parallel agents that compose other agents into multi-step workflows with loops and conditionals.
- **Tool agents** — deterministic function calls with no LLM in the loop.
- **Long-running conversations** — sessions persist message history across calls.
- **Streaming UIs** — full event stream (tokens, tool calls, replies) over Server-Sent Events.
- **Multi-tenant products** — every record is user-scoped on the hosted edition.

Three things stay the same as you scale from your laptop to production:

1. **The YAML schema.** One \`manifest.yaml\` runs in embedded mode, hosted mode, and self-hosted mode.
2. **The client API.** \`client.agents.run({ agentId, input })\` — same call against \`@agntz/sdk\` and \`@agntz/client\`.
3. **The observability model.** Runs, spans, and traces work identically in every edition.

## Choose your starting point

| If you want to… | Use | Read |
|---|---|---|
| Run an agent on your laptop in 60 seconds | \`@agntz/sdk\` | [Quickstart — local](#quickstart-local-runner) |
| Author and run agents in a hosted UI | agntz.co | [Hosted cloud](#hosted-cloud) |
| Call hosted agents from your backend | \`@agntz/client\` | [Calling agents from code](#calling-agents-from-code) |
| Deploy your own hosted stack | Docker / Vercel + Railway | [Self-host](#self-host) |

## Install

\`\`\`bash
# Embedded: run agents in-process from YAML files
pnpm add @agntz/sdk

# Hosted client: call agents on agntz.co or your own worker
pnpm add @agntz/client

# Optional persistence for embedded mode
pnpm add @agntz/store-sqlite
\`\`\`

Node 20+ in both cases. The SDK is universal (browsers + Node + edge runtimes); the runner is Node-only because it reads YAML from disk.

Set the provider API key your agents will use:

\`\`\`bash
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY=sk-ant-...
# or GOOGLE_GENERATIVE_AI_API_KEY=...
\`\`\`

agntz calls providers directly with your key — no proxy, no data routing.

## Quickstart — local runner

The fastest path: write a YAML file, point \`@agntz/sdk\` at the directory, call it. No server, no signup, no infrastructure.

### 1. Create an agent

\`\`\`yaml [agents/support.yaml]
id: support
kind: llm
model:
  provider: anthropic
  name: claude-sonnet-4-6
instruction: |
  You are a friendly customer support agent. Answer concisely.

  {{userQuery}}
\`\`\`

### 2. Run it

\`\`\`ts [index.ts]
import { agntz } from "@agntz/sdk";

const client = await agntz({ agents: "./agents" });

const result = await client.agents.run({
  agentId: "support",
  input: "How do I reset my password?",
});

console.log(result.output);
\`\`\`

\`\`\`bash
export ANTHROPIC_API_KEY=sk-ant-...
node --experimental-strip-types index.ts
\`\`\`

That's it. The runner parses every \`.yaml\` file under \`./agents\`, validates them against the schema, registers them with an in-process runtime, and exposes the same \`client.agents.run / stream\`, \`client.runs.list\`, \`client.traces.get\` surface as the hosted SDK.

### 3. Use the same code against the hosted cloud later

When you outgrow embedded mode — durable run history, multi-user isolation, agent management UI — change one line:

\`\`\`diff
- import { agntz } from "@agntz/sdk";
+ import { agntz } from "@agntz/client";

- const client = await agntz({ agents: "./agents" });
+ const client = agntz({ apiKey: process.env.AGNTZ_API_KEY });
\`\`\`

The \`agents.run\`, \`agents.stream\`, \`runs.list\`, and \`traces.get\` calls work identically. YAML manifests move to the hosted registry; in-process \`tools\` become MCP servers or HTTP endpoints.

## Defining agents

Agents are declared in YAML manifests. The file's \`id\` is the agent's identifier; \`kind\` selects one of four agent types.

### The four agent kinds

**Primitive** — building blocks:
- \`llm\` — calls a language model with an instruction, optional tools, and optional structured output.
- \`tool\` — deterministic function call. No LLM, no reasoning — just maps state to tool parameters.

**Pipeline** — compose primitives (and other pipelines):
- \`sequential\` — runs steps in order; optionally loops with \`until\`.
- \`parallel\` — runs branches simultaneously and merges their outputs.

### Simplest LLM agent

No \`inputSchema\` means the agent takes a plain string, accessible in templates as \`{{userQuery}}\`:

\`\`\`yaml [agents/chatbot.yaml]
id: chatbot
name: Chatbot
description: A simple conversational assistant
kind: llm

model:
  provider: openai
  name: gpt-5.4-mini
  temperature: 0.7

instruction: |
  You are a friendly, helpful assistant. Answer the user's question clearly and concisely.

  {{userQuery}}
\`\`\`

### Structured input and output

\`inputSchema\` declares what the agent expects; \`outputSchema\` constrains what the model returns. Properties are listed directly — the object wrapper is implicit.

\`\`\`yaml [agents/sentiment-analyzer.yaml]
id: sentiment-analyzer
name: Sentiment Analyzer
kind: llm

inputSchema:
  text: string

model:
  provider: openai
  name: gpt-5.4-nano
  temperature: 0

instruction: |
  Analyze the sentiment of the following text and respond with a JSON object.

  Text: {{text}}

outputSchema:
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number

examples:
  - input: "I absolutely love this product!"
    output: '{"sentiment": "positive", "confidence": 0.95}'
  - input: "The package arrived on Tuesday."
    output: '{"sentiment": "neutral", "confidence": 0.88}'
\`\`\`

Call it from code:

\`\`\`ts
const { output } = await client.agents.run({
  agentId: "sentiment-analyzer",
  input: { text: "I love this!" },
});
// output = { sentiment: "positive", confidence: 0.95 }
\`\`\`

### Tool agents

Deterministic. No LLM. Just maps state values to a tool call.

\`\`\`yaml [agents/send-email.yaml]
id: send-email
kind: tool

inputSchema:
  recipientEmail: string
  emailSubject: string
  emailBody: string

tool:
  kind: mcp
  server: https://email-api.example.com/mcp
  name: send_email
  params:
    to: "{{recipientEmail}}"
    subject: "{{emailSubject}}"
    body: "{{emailBody}}"
\`\`\`

### Pipeline agents

Sequential agents run steps in order. Each step's output is added to state and available to downstream steps as \`{{stepId.property}}\`.

\`\`\`yaml [agents/research-and-summarize.yaml]
id: research-and-summarize
kind: sequential

inputSchema:
  userQuery: string

steps:
  - ref: researcher
    input:
      query: "{{userQuery}}"

  - agent:
      id: summarizer
      kind: llm
      model: { provider: openai, name: gpt-5.4 }
      instruction: |
        Summarize this research: {{researcher}}
      outputSchema:
        summary: string

output:
  summary: "{{summarizer.summary}}"
  sourceResearch: "{{researcher}}"
\`\`\`

Parallel agents run branches simultaneously and merge their outputs into state:

\`\`\`yaml
id: text-analysis
kind: parallel

inputSchema:
  text: string

branches:
  - ref: sentimentAnalyzer
    input: { text: "{{text}}" }
  - ref: entityExtractor
    input: { text: "{{text}}" }
\`\`\`

### Looping

Add \`until\` to make a sequential agent loop. \`maxIterations\` is the safety stop.

\`\`\`yaml
id: write-review-loop
kind: sequential

until: "{{reviewer.approved}} == true"
maxIterations: 5

steps:
  - ref: writer
    input:
      topic: "{{topic}}"
      feedback: "{{reviewer.feedback}}"   # null on first iteration
  - ref: reviewer
    input:
      draft: "{{writer.draft}}"
\`\`\`

### Full composition

Pipelines nest. Inline an agent with \`agent:\`, or reference a stored one by id with \`ref:\`.

\`\`\`yaml [agents/article-pipeline.yaml]
id: article-pipeline
kind: sequential

inputSchema:
  topic: string
  tone:
    type: string
    default: professional

steps:
  # Step 1: research in parallel
  - agent:
      id: research-phase
      kind: parallel
      stateKey: research
      branches:
        - ref: web-researcher
          input: { query: "{{topic}}" }
        - ref: academic-researcher
          input: { query: "{{topic}}" }

  # Step 2: write + review until approved
  - agent:
      id: write-review
      kind: sequential
      stateKey: writing
      until: "{{editor.approved}} == true"
      maxIterations: 3
      steps:
        - ref: writer
          input:
            topic: "{{topic}}"
            tone: "{{tone}}"
            webResearch: "{{research.webResearcher}}"
            academicResearch: "{{research.academicResearcher}}"
            feedback: "{{editor.feedback}}"
        - ref: editor
          input: { draft: "{{writer.draft}}" }

  # Step 3: notify
  - agent:
      id: notify
      kind: tool
      tool:
        kind: local
        name: send_slack
        params:
          channel: "#content"
          message: "New article ready: {{topic}}"

output:
  article: "{{writing.writer.draft}}"
  review: "{{writing.editor}}"
\`\`\`

## Tools

LLM agents can call tools the model selects, or you can call them deterministically via \`tool\` agents. Four kinds are supported in YAML; all four work in both embedded and hosted modes (with one caveat noted below).

### Local tools

JavaScript / TypeScript functions registered at runtime, referenced by name in YAML.

\`\`\`yaml [agents/calculator.yaml]
id: calculator
kind: llm
model: { provider: openai, name: gpt-5.4-mini }
instruction: |
  Use the \`add\` tool to answer math questions.

  {{userQuery}}
tools:
  - kind: local
    tools: [add]
\`\`\`

\`\`\`ts [index.ts]
const client = await agntz({
  agents: "./agents",
  tools: {
    add: async ({ a, b }: { a: number; b: number }) => a + b,
  },
});
\`\`\`

Names referenced in YAML but missing from the \`tools\` map fail at **load time**, not on first model call — misconfigurations surface immediately.

> **Note:** Local tools are an embedded-mode primitive. The hosted edition has no way to run arbitrary user code in a sandbox, so promote local tools to HTTP endpoints or MCP servers when you graduate.

### HTTP tools

A single HTTP endpoint exposed to the model as a tool. URL placeholders define the LLM-facing parameter schema. \`GET\`, \`POST\`, \`PUT\`, \`PATCH\`, and \`DELETE\` are all supported.

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

URL placeholder syntax:
- \`{X}\` — required (path or query)
- \`{X?}\` — optional (query only)

Headers are templated and can reference env vars (\`{{env.NAME}}\` in embedded mode) or secrets (\`{{secrets.NAME}}\` in hosted mode).

#### POST / PUT / PATCH with a request body

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

#### Dynamic auth — OAuth2 client credentials

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

#### Dynamic auth — generic token exchange

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

What you get for free: per-tenant token caching, single-flight dedup of concurrent requests, automatic refresh-on-401 (one retry, no infinite loops), and redaction of known token / secret substrings from response bodies and error messages.

### MCP tools

MCP servers expose discoverable tools. Reference a server URL; expose all its tools, or pick specific ones.

\`\`\`yaml
tools:
  - kind: mcp
    server: https://search-api.example.com/mcp
    tools:
      - fetch_url
      - tool: search                    # wrapped tool
        name: search_for_user           # what the LLM sees
        description: "Search records by query"
        params:
          api_key: "{{env.SEARCH_KEY}}"   # pinned, hidden from the LLM
\`\`\`

In embedded mode, the runner connects lazily on first tool call and reuses the connection for the process lifetime. No connection store required.

### Agent-as-tool

Expose another agent as a callable tool. The parent LLM decides when to delegate.

\`\`\`yaml
tools:
  - kind: agent
    agent: researcher
\`\`\`

The child agent shows up in the parent's trace as a nested span, complete with its own model calls and tool calls.

### Tool wrapping

For MCP and HTTP tools, you can pin parameters from state — they're injected at execution and hidden from the LLM's schema. This is how you ground tools in per-invocation context (user id, tenant id, secrets) without trusting the model to pass them.

\`\`\`yaml
tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:
      - tool: search
        name: search_current_user      # optional rename
        description: "Search the current user's records"
        params:
          user_id: "{{userId}}"        # state-templated, hidden
\`\`\`

## Schema reference

Complete reference for the YAML manifest. Every agent kind, every field.

### Common fields

\`\`\`yaml
id: my-agent                          # required, unique within the registry
name: My Agent                        # optional, display label
description: Does a thing             # optional, surfaced in UIs
kind: llm                             # llm | tool | sequential | parallel
\`\`\`

### Input

\`inputSchema\` declares the agent's input contract. Properties are listed directly; all are **required but nullable**.

\`\`\`yaml
inputSchema:
  query: string
  language:
    type: string
    default: en
  format:
    type: string
    enum: [json, text, markdown]
\`\`\`

If omitted, the agent accepts a plain string, accessible in templates as \`{{userQuery}}\`.

### State

State is scoped per agent. Sub-agents have their own state and cannot see the parent's.

\`\`\`
{
  ...input,                                              # input properties at root
  [stateKey ?? normalizeId(subAgent)]: subAgentOutput    # per sub-agent
}
\`\`\`

Rules:
- \`{{varName}}\` references root input properties.
- \`{{agentId.property}}\` references a sub-agent's output property.
- Unresolved references (skipped steps, first loop iteration) resolve to **null**.

### Model config (LLM kind only)

\`\`\`yaml
model:
  provider: openai            # openai | anthropic | google | mistral
  name: gpt-5.4
  temperature: 0.7            # optional
  maxTokens: 4096             # optional
  topP: 1.0                   # optional
\`\`\`

### Instruction and prompt

Two roles, kept separate.

\`\`\`yaml
instruction: |               # required — the system prompt
  You are a math tutor. Explain each step clearly.

prompt: |                    # optional — user-message template
  Solve carefully: {{userQuery}}
\`\`\`

- **\`instruction\`** is the system prompt. Templated with \`{{}}\` against state.
- **\`prompt\`** is the user message. When absent, the agent's raw input (\`{{userQuery}}\` or the input object stringified) is sent verbatim.

### Output

LLM agents use \`outputSchema\` to enforce structured output:

\`\`\`yaml
outputSchema:
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number
\`\`\`

Pipeline agents use \`output\` to map state to the result. Optional — defaults to the last step's output (sequential) or all branch outputs keyed by id (parallel).

\`\`\`yaml
output:
  article: "{{writing.writer.draft}}"
  review: "{{writing.editor}}"
\`\`\`

### Templates

Instructions support \`{{}}\` for variable interpolation and conditional blocks.

\`\`\`yaml
instruction: |
  You are a writing assistant. Write about {{topic}} in a {{tone}} tone.

  {{#if feedback}}
  The reviewer provided feedback. Incorporate it:
  {{feedback}}
  {{/if}}

  {{#if language != en}}
  Write your response in {{language}}.
  {{/if}}
\`\`\`

- \`{{varName}}\` — replaced with the resolved value. Null renders empty.
- \`{{#if varName}} … {{/if}}\` — truthiness (non-null, non-empty).
- \`{{#if varName == value}} … {{/if}}\` — equality. \`!=\` also supported.

### Conditions

Used in step-level \`when\` and sequential \`until\`. Evaluated against resolved state.

\`\`\`yaml
when: "{{language}} != en"
when: "{{feedback}}"                                     # truthiness
until: "{{score}} >= 0.8"
until: "{{score}} >= 0.8 && {{reviewer.approved}} == true"
\`\`\`

Operators: \`==\`, \`!=\`, \`>\`, \`<\`, \`>=\`, \`<=\`, \`&&\`, \`||\`. Truthiness = non-null, non-empty, non-zero.

### Pipeline step fields

Every step in \`steps:\` or \`branches:\` uses either \`ref\` (existing agent id) or \`agent\` (inline definition):

\`\`\`yaml
steps:
  - ref: agent-id
    input:
      paramX: "{{stateVar}}"           # maps parent state to child input
    stateKey: customKey                 # rename where output lands
    when: "{{condition}} == value"     # skip if false (output = null)

  - agent:
      id: inline-agent
      kind: llm
      model: { provider: openai, name: gpt-5.4 }
      instruction: "..."
\`\`\`

All agents — including inline — require an \`id\` for tracing.

### Skills (LLM kind)

Named skill bundles the agent may load mid-run via the synthetic \`use_skill\` tool. Names must match \`^[a-z][a-z0-9-]*$\` and resolve against the runtime's SkillStore.

\`\`\`yaml
skills:
  - citation-style
  - markdown-rendering
\`\`\`

### Spawnable (LLM kind)

Sub-agents the LLM may spawn concurrently at runtime via the synthetic \`spawn_agent\` tool. Predefined per agent — the LLM cannot invent agents.

\`\`\`yaml
spawnable:
  - kind: ref
    agentId: fact-checker
  - kind: inline
    definition:
      id: adhoc-helper
      kind: llm
      model: { provider: openai, name: gpt-5.4-mini }
      instruction: "Extract dates from the input"
\`\`\`

Inline spawnable definitions must be \`kind: llm\` with a static (non-templated) instruction.

### Reply (LLM kind)

Register a per-invocation \`reply\` tool the model can call to deliver intermediate messages. Replies surface as SSE events on streaming endpoints.

\`\`\`yaml
reply: true                  # defaults: maxPerRun = 50

# or
reply:
  maxPerRun: 5
\`\`\`

### Error handling

Pipelines **fail fast**. If any step fails, the entire pipeline fails immediately. There's no per-step retry config in the manifest — handle retries at the caller level via run options.

## Calling agents from code

The \`@agntz/sdk\` and \`@agntz/client\` clients expose the same shape: \`client.agents\`, \`client.runs\`, \`client.traces\`. Code that's written against one runs against the other.

### Embedded — \`@agntz/sdk\`

\`\`\`ts
import { agntz } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tools: { add: async ({ a, b }) => a + b },
  onEvent: (event) => {
    if (event.type === "tool-call-start") console.log("→", event.toolCall.name);
  },
});

// Non-streaming
const { output, state } = await client.agents.run({
  agentId: "support",
  input: { message: "Hello" },
});

// Streaming
for await (const event of client.agents.stream({
  agentId: "support",
  input: { message: "Hello" },
})) {
  if (event.type === "reply") process.stdout.write(event.text);
  if (event.type === "complete") console.log("\\nfinal:", event.output);
}

// Runs & traces (in-memory ring buffer, default 1000)
const { rows } = await client.runs.list({ limit: 10 });
const trace = await client.traces.get(rows[0].id);
\`\`\`

### Hosted — \`@agntz/client\`

\`\`\`ts
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,    // ar_live_...
  baseUrl: "https://api.agntz.co",       // or your self-hosted worker URL
});

// Non-streaming
const { output, state } = await client.agents.run({
  agentId: "support-agent",
  input: { message: email.body, customerId: email.from },
});

// Streaming with cancellation
const controller = new AbortController();
for await (const event of client.agents.stream({
  agentId: "support-agent",
  input: { message: "Hello" },
  signal: controller.signal,
})) {
  if (event.type === "complete") console.log("output", event.output);
  if (event.type === "error") console.error(event.error);
}

// Runs lifecycle
const run = await client.runs.start({ agentId: "support-agent", input: { ... } });
const fresh = await client.runs.get(run.id);
await client.runs.cancel(run.id);   // cascades to all descendants

// Traces
const traces = await client.traces.list({ status: "error", limit: 20 });
const detail = await client.traces.get(traces.rows[0].id);
\`\`\`

### Sessions

Pass the same \`sessionId\` across runs to continue a conversation. The runtime auto-loads and appends history.

\`\`\`ts
await client.agents.run({ agentId: "support", input: "Hi", sessionId: "user-42" });
await client.agents.run({ agentId: "support", input: "follow-up", sessionId: "user-42" });
\`\`\`

In embedded mode, sessions live in memory by default. For persistence, install \`@agntz/store-sqlite\` and use the \`sqlite\` subpath:

\`\`\`ts
import { agntz } from "@agntz/sdk";
import { sqliteStore } from "@agntz/sdk/sqlite";

const client = await agntz({
  agents: "./agents",
  store: sqliteStore("./agntz.db"),
});
\`\`\`

In hosted mode, sessions are managed automatically and scoped to your user.

### Stream events

The event union your code will see:

| \`event.type\` | When | Payload |
|---|---|---|
| \`start\` | First event of a run | \`{ runId, kind }\` |
| \`text-delta\` | Streaming token from the model | \`{ text }\` |
| \`tool-call-start\` | Model invoked a tool | \`{ toolCall }\` |
| \`tool-call-end\` | Tool returned | \`{ toolCall, result }\` |
| \`reply\` | Model called the \`reply\` tool (if enabled) | \`{ text }\` |
| \`step-complete\` | One tool-loop iteration finished | \`{ step }\` |
| \`complete\` | Terminal — full result | \`{ output, state, usage }\` |
| \`error\` | Terminal — failure | \`{ error }\` |

Always handle \`complete\` and \`error\` as terminal. \`break\` from a \`for await\` loop cleans up the underlying stream automatically.

### Errors

\`\`\`ts
import { AgntzError, AuthenticationError, NotFoundError, StreamError } from "@agntz/client";

try {
  await client.agents.run({ agentId: "unknown", input: {} });
} catch (err) {
  if (err instanceof NotFoundError) {
    // 404 — unknown agent id
  }
  if (err instanceof AuthenticationError) {
    // 401 — invalid or revoked API key
  }
  if (err instanceof StreamError) {
    // SSE protocol failure
  }
}
\`\`\`

All errors extend \`AgntzError\`. The embedded runner re-exports the same types so error-handling code is portable.

## Runs and traces

Every invocation produces a **Run** (top-level execution) and a **Trace** (span tree below it).

A trace's spans cover three kinds of work:
- \`agent.invoke\` — the root span for an agent run (and one per sub-agent).
- \`model.call\` — each LLM API call (usage, finish reason, latency).
- \`tool.execute\` — each tool execution (tool name, duration, errors).

Spans are nested. A sequential pipeline's trace looks like:

\`\`\`
agent.invoke article-pipeline
├── agent.invoke research-phase   (parallel)
│   ├── agent.invoke web-researcher
│   │   └── model.call gpt-5.4
│   └── agent.invoke academic-researcher
│       └── model.call gpt-5.4
└── agent.invoke write-review     (loop, 2 iterations)
    ├── agent.invoke writer
    │   └── model.call claude-sonnet-4-6
    └── agent.invoke editor
        └── model.call gpt-5.4-mini
\`\`\`

### Listing and inspecting

\`\`\`ts
// List recent runs
const { rows } = await client.runs.list({
  agentId: "support-agent",
  status: "error",
  limit: 50,
});

// Drill into one
const trace = await client.traces.get(rows[0].id);
for (const span of trace.spans) {
  console.log(span.kind, span.name, span.durationMs, span.status);
}

// Stream live traces as a run executes
for await (const event of client.traces.stream(runId)) {
  if (event.type === "span-start") console.log("→", event.span.name);
  if (event.type === "span-end") console.log("←", event.span.name, event.span.durationMs);
}
\`\`\`

### OpenTelemetry

If you'd rather pipe agntz spans into your existing observability stack, pass an OTel tracer. Zero overhead when not configured.

\`\`\`ts
import { trace } from "@opentelemetry/api";

const runner = createRunner({
  telemetry: {
    tracer: trace.getTracer("my-app"),
    recordIO: false,           // don't capture input/output (privacy default)
    recordToolIO: false,
    baseAttributes: {
      "service.name": "my-app",
      "deployment.environment": "production",
    },
  },
});
\`\`\`

## Hosted cloud

The hosted edition at **agntz.co** gives you the same runtime plus a managed multi-tenant UI. Sign up, create an agent, run it — no infrastructure.

### What you get in the UI

- **Agent editor** — YAML manifest editor with live schema validation, plus AI-assisted build-from-description.
- **Playground** — per-agent interactive runner with SSE streaming, conversational sessions.
- **Sessions & logs** — browse conversation history and invocation traces with span detail.
- **Tool catalog** — list the inline / MCP tools available to your workspace.
- **Providers** — manage your LLM provider keys per workspace.
- **API keys** — generate \`ar_live_*\` keys for programmatic access from your apps.
- **Auth** — Clerk-backed sign-in / sign-up; every record is scoped to your \`userId\`.

### From UI to code in one step

Create an agent in the UI, then call it with the same SDK code you'd use locally — just point the SDK at the hosted worker:

\`\`\`ts
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://api.agntz.co",
});

const { output } = await client.agents.run({
  agentId: "support-agent",     // the id you set in the UI editor
  input: { message: "Hello" },
});
\`\`\`

Every UI-side change is versioned, every run is traced — same observability model as embedded.

### Versioning

Every save creates a new version of the agent. Production resolves \`support-agent\` to the **pinned** version; in-flight edits never reach users until you pin them. The version that produced any given trace is recorded with the trace, so you can jump from a run straight to the exact manifest that ran it.

## Self-host

The whole stack is open source under MIT. You can run it yourself — locally with Docker Compose, or in production on Vercel + Railway + Postgres.

The deployable surface is three packages:

| Package | Role | Port |
|---|---|---|
| \`@agntz/app\` | Next.js 15 web UI (Clerk auth, agent editor, playground) | 3000 |
| \`@agntz/worker\` | Hono HTTP worker — executes agents, exposes \`/run\` and \`/run/stream\` | 4001 |
| \`@agntz/store-postgres\` | Postgres store adapter — user-scoped tables | — |

### Local — Docker Compose

The repo ships a \`docker-compose.yml\` that spins up Postgres + worker + app + site. Clone, set env, run:

\`\`\`bash
git clone https://github.com/aparry3/agntz
cd agntz
cp .env.example .env.local
# fill in CLERK_*, WORKER_INTERNAL_SECRET, OPENAI_API_KEY
docker compose up
\`\`\`

UI at \`http://localhost:3000\`, worker at \`http://localhost:4001\`.

### Production — Vercel + Railway

Recommended split: Next.js apps on **Vercel**, worker + Postgres on **Railway**.

#### 1. Provision Postgres on Railway

\`\`\`
Railway → New Project → Add Service → Database → PostgreSQL
\`\`\`

Copy the \`DATABASE_URL\` from the Variables tab. Schema is initialized on worker boot — no manual migration.

#### 2. Deploy the worker on Railway

Same Railway project → **Add Service** → **GitHub Repo** → select your fork.

- **Root directory:** \`/\`
- **Build:** Dockerfile, target stage \`worker\`
- **Port:** \`4001\`
- **Env vars:**
  - \`STORE=postgres\`
  - \`DATABASE_URL=\${{Postgres.DATABASE_URL}}\`
  - \`PORT=4001\`
  - \`WORKER_INTERNAL_SECRET=$(openssl rand -base64 32)\`
  - \`DEFAULT_MODEL_PROVIDER=openai\`
  - \`DEFAULT_MODEL_NAME=gpt-5.4\`
  - \`OPENAI_API_KEY=sk-...\`
  - (any other provider keys you'll use)

Generate a public domain in **Settings → Networking**; you'll need it for the app.

#### 3. Set up Clerk

Sign up at clerk.com, create an application, copy the **Publishable** and **Secret** keys from the API Keys page. No Organizations setup needed.

#### 4. Deploy the app on Vercel

\`\`\`
Vercel → New Project → Import your repo
- Root directory: packages/app
- Framework preset: Next.js
\`\`\`

Env vars:

\`\`\`
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/agents
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/agents
WORKER_URL=https://<your-worker>.up.railway.app
WORKER_INTERNAL_SECRET=...           # MUST match the worker
STORE=postgres
DATABASE_URL=...                     # same Postgres as the worker
DEFAULT_MODEL_PROVIDER=openai
DEFAULT_MODEL_NAME=gpt-5.4
OPENAI_API_KEY=sk-...
\`\`\`

\`WORKER_INTERNAL_SECRET\` must be identical on both sides — the app authenticates to the worker with it.

#### 5. (Optional) Deploy the marketing site on Vercel

The marketing site at \`packages/site\` is a separate Vercel project — no env vars required.

\`\`\`
Root directory: packages/site
\`\`\`

#### 6. DNS

Suggested layout for a custom domain:

| Hostname | Project | Purpose |
|---|---|---|
| \`yourdomain.com\` | site | Marketing |
| \`www.yourdomain.com\` | site | Marketing (alias) |
| \`app.yourdomain.com\` | app | Product UI |

In your registrar, add the records Vercel lists (typically A \`76.76.21.21\` for apex, CNAME \`cname.vercel-dns.com\` for subdomains). Vercel auto-issues certs once DNS resolves.

In Clerk → **Domains** — add the production URL as an allowed origin, swap test keys for production keys, redeploy.

### Architecture

\`\`\`
 Browser ──(Clerk session)──► app (Next.js) ──(X-Internal-Secret + userId)──► worker (Hono)
 External caller ──(Bearer ar_live_...)─────────────────────────────────────► worker
                                                                                  │
                                                                                  ▼
                                                                        Postgres (user_id scoped)
\`\`\`

The worker accepts two auth modes:
- **Internal** — \`X-Internal-Secret\` header + \`userId\` in the request body. Used by the app on behalf of signed-in users.
- **External** — \`Authorization: Bearer ar_live_<token>\` from a key generated in **Settings → API Keys**. The worker sha256-hashes the key and resolves it to a \`user_id\`.

Every store row is scoped to a Clerk \`userId\`. The app never sees another user's data.

## HTTP API reference

The worker exposes a small HTTP surface. The SDK wraps it; you can also call it directly.

### Endpoints

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

### Request shape

\`\`\`json
{
  "userId": "user_abc...",
  "agentId": "my-agent",
  "input": { "message": "Hello" },
  "sessionId": "optional-session-id"
}
\`\`\`

\`userId\` is only required when authenticating with \`X-Internal-Secret\` (the app's mode). With an \`ar_live_*\` Bearer token, the worker resolves the user from the key.

### System agents

Invoke a system agent — bundled with the worker, not user-defined — by prefixing the id with \`system:\`:

\`\`\`json
{ "agentId": "system:agent-builder", "input": { "description": "..." } }
\`\`\`

The default \`agent-builder\` powers the UI's "Create from description" feature. System agents bypass the user's store and run with ephemeral in-memory state.

## CLI

A small CLI ships with the SDK for one-off invocations:

\`\`\`bash
# Scaffold a project (creates agents/ + index.ts + package.json)
npx agntz init

# Invoke an agent from the command line
npx agntz invoke greeter "Hello!"

# Run evals
npx agntz eval classifier

# REPL — multi-turn playground for one agent
npx agntz playground greeter
\`\`\`

The playground keeps a single session across turns:

\`\`\`
  agntz playground
  Agent: greeter
  Session: playground_1741506000000
  Type .exit or Ctrl+C to quit

you › Hello!

greeter › Hey there! Welcome — great to have you here.
  42 tokens · 312ms
\`\`\`

Commands: \`.new\` (new session), \`.session\` (show id), \`.exit\` (quit).

## Compatibility matrix

What runs where, today.

| Feature | Embedded (\`@agntz/sdk\`) | Hosted (\`agntz.co\` / self-host) |
|---|:---:|:---:|
| LLM agents | ✓ | ✓ |
| Sequential / parallel / tool kinds | ✓ | ✓ |
| Local tools (in-process JS/TS) | ✓ | (use MCP / HTTP instead) |
| HTTP tools | ✓ | ✓ |
| MCP tools (raw URL + headers) | ✓ | ✓ |
| Agent-as-tool | ✓ | ✓ |
| Spawnable subagents | ✓ | ✓ |
| Sessions | ✓ (memory or sqlite) | ✓ (managed) |
| Runs & traces | ✓ (in-memory ring buffer) | ✓ (persisted in Postgres) |
| Streaming for LLM agents | ✓ (full event stream) | ✓ |
| Streaming for pipelines | ✓ (single \`complete\` event) | ✓ |
| \`{{env.X}}\` template refs | ✓ | (opt-in per server) |
| \`{{secrets.X}}\` template refs | × | ✓ |
| Versioning + pinning | × | ✓ |
| Multi-user isolation | × | ✓ |
| API key auth | × | ✓ |
| Evals UI | × | (roadmap) |

## Resources

- **GitHub:** [github.com/aparry3/agntz](https://github.com/aparry3/agntz) — source, issues, discussions.
- **npm:** \`@agntz/sdk\`, \`@agntz/client\`, \`@agntz/store-sqlite\`, \`@agntz/store-postgres\`, \`@agntz/manifest\`.
- **Examples:** \`examples/agents/*.yaml\` in the repo — every agent kind demonstrated.
- **License:** MIT.
- **AI-friendly:** This page is also available as raw markdown at [/llms.txt](/llms.txt).
`;
