# agntz YAML Schema

Agent definitions are YAML manifests that describe what an agent does, what it expects, and how it composes with other agents. This document is the complete reference for the schema.

## Agent Kinds

There are four agent kinds, split into two categories:

**Primitive** agents are the building blocks:
- **`llm`** -- calls a language model
- **`tool`** -- deterministic function call, no LLM involved

**Pipeline** agents compose primitives (and other pipelines):
- **`sequential`** -- runs steps in order; optionally loops with `until`
- **`parallel`** -- runs branches simultaneously

---

## Common Fields

Every agent definition supports these fields, **including inline agents** in pipeline steps (id is required everywhere for debugging and tracing):

```yaml
id: my-agent                        # unique identifier (required, even inline)
name: My Agent                      # display name (optional)
description: Does a thing            # what this agent does (optional)
kind: llm                           # llm | tool | sequential | parallel (required)
```

---

## Input

`inputSchema` declares what the agent expects as input. Properties are listed directly -- the object wrapper is implicit. All properties are **required but nullable**.

```yaml
inputSchema:
  query: string
  language:
    type: string
    default: en
  format:
    type: string
    enum: [json, text, markdown]
```

Simple properties use shorthand (`prop: string`). Properties with constraints use the expanded form (`prop: { type, default, enum, min, max, ... }`). Both can mix freely.

If `inputSchema` is omitted, the agent accepts a plain string, accessible in templates as `{{userQuery}}`.

---

## State

State is scoped per agent. Sub-agents have their own encapsulated state and cannot see parent state.

```
{
  ...input,                                            # input properties at root
  [stateKey ?? normalizeId(subAgent)]: subAgentOutput  # per sub-agent
}
```

When no `inputSchema` is declared:

```
{
  userQuery: "the raw input string",
  ...subAgentOutputs
}
```

**Rules:**
- `{{varName}}` references root input properties
- `{{agentId.property}}` references sub-agent output properties
- Unresolved references (skipped steps, first loop iteration) resolve to **null**

### stateKey

By default, a sub-agent's output lands on the parent state under its normalized id. Override this with `stateKey`:

```yaml
steps:
  - agent: my-long-agent-name
    stateKey: short                  # access as {{short}} instead of {{my-long-agent-name}}
```

---

## LLM Agent

Calls a language model with an instruction, optional tools, and optional structured output.

```yaml
id: sentiment-analyzer
name: Sentiment Analyzer
kind: llm

inputSchema:
  text: string

model:
  provider: openai                   # openai | anthropic | google | mistral
  name: gpt-5.4
  temperature: 0.7                   # optional
  maxTokens: 4096                    # optional
  topP: 1.0                         # optional

instruction: |
  Analyze the sentiment of the following text: {{text}}

examples:                            # few-shot examples (optional)
  - input: "I love this product!"
    output: "positive"
  - input: "Terrible experience."
    output: "negative"

tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:
      - toolA
      - toolB
      - tool: search
        name: search_current_user
        description: "Search by query text"
        params:
          api_key: "{{apiKey}}"
          user_id: "{{userId}}"

  - kind: local
    tools: [calculator, dateFormatter]

  - kind: agent
    agent: researcher

outputSchema:
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number
```

### Minimal LLM agent (no inputSchema)

```yaml
id: simple-chatbot
name: Simple Chatbot
kind: llm

model:
  provider: openai
  name: gpt-5.4

instruction: |
  You are a helpful assistant. Answer the user's question: {{userQuery}}
```

---

## Tool Agent

Deterministic function call. No LLM, no reasoning -- just maps state to tool params and calls it.

```yaml
id: send-notification
name: Send Notification
kind: tool

inputSchema:
  recipientEmail: string
  emailSubject: string
  emailBody: string

tool:
  kind: mcp                          # or local
  server: https://mcp.example.com/sse
  name: send_email
  params:
    to: "{{recipientEmail}}"
    subject: "{{emailSubject}}"
    body: "{{emailBody}}"
```

---

## Sequential Agent

Runs steps in order. Each step's output is added to state for downstream steps.

```yaml
id: research-and-summarize
name: Research and Summarize
kind: sequential

inputSchema:
  userQuery: string
  language:
    type: string
    default: en

steps:
  - ref: researcher
    input:
      query: "{{userQuery}}"

  - agent:
      id: summarizer
      kind: llm
      model:
        provider: openai
        name: gpt-5.4
      instruction: |
        Summarize this research: {{researcher}}
      outputSchema:
        summary: string
      stateKey: summarizer

  - ref: translator
    when: "{{language}} != en"
    input:
      text: "{{summarizer.summary}}"
      targetLanguage: "{{language}}"

  - ref: formatter
    input:
      content: "{{summarizer.summary}}"
    stateKey: final

output:
  result: "{{final}}"
  originalResearch: "{{researcher}}"
  translation: "{{translator}}"      # null if translator was skipped
```

**Default output:** last step's output. Override with an explicit `output` mapping.

### Looping

Add `until` to make a sequential agent loop its steps until a condition is met. `maxIterations` is an optional safety limit.

```yaml
id: write-review-loop
name: Write and Review
kind: sequential

inputSchema:
  topic: string

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

output:
  finalDraft: "{{writer.draft}}"
  reviewerNotes: "{{reviewer.feedback}}"
```

---

## Parallel Agent

Runs branches simultaneously. All branch outputs merge into state.

```yaml
id: analyze-text
name: Analyze Text
kind: parallel

inputSchema:
  text: string

branches:
  - ref: sentimentAnalyzer
    input:
      text: "{{text}}"

  - ref: entityExtractor
    input:
      text: "{{text}}"

  - agent:
      id: intent-classifier
      kind: llm
      model:
        provider: anthropic
        name: claude-sonnet-4-6
      instruction: "Classify the intent of: {{text}}"
      outputSchema:
        intent: string
      stateKey: intentClassifier

output:
  sentiment: "{{sentimentAnalyzer}}"
  entities: "{{entityExtractor}}"
  intent: "{{intentClassifier.intent}}"
```

**Default output:** all branch outputs as an object keyed by `stateKey` / normalized id (e.g. `{ sentimentAnalyzer, entityExtractor, intentClassifier }`). Override with an explicit `output` mapping.

---

## Composition

Agents compose by nesting. A pipeline step uses `ref` to reference an existing agent by id, or `agent` to define one inline.

### By reference (`ref`)

```yaml
- ref: agent-id
  input:
    paramX: "{{stateVar}}"
  stateKey: customKey
  when: "{{condition}} == value"
```

### Inline (`agent`)

```yaml
- agent:
    id: my-inline-agent
    kind: llm
    model:
      provider: openai
      name: gpt-5.4
    instruction: "..."
  input:
    paramX: "{{stateVar}}"
  stateKey: customKey
  when: "{{condition}} == value"
```

Every step must have either `ref` or `agent`, not both. All agents (including inline) require an `id` for debugging and tracing.

Step-level fields:
- **`input`** -- transform: maps parent state to the child agent's expected input
- **`stateKey`** -- overrides where this step's output lands on parent state
- **`when`** -- conditional execution; if false, step is skipped and its output is null

### Full example

```yaml
id: article-pipeline
name: Article Pipeline
kind: sequential

inputSchema:
  topic: string
  tone:
    type: string
    default: professional

steps:
  # Step 1: Research in parallel
  - agent:
      id: research-phase
      kind: parallel
      stateKey: research
      branches:
        - ref: web-researcher
          input:
            query: "{{topic}}"
        - ref: academic-researcher
          input:
            query: "{{topic}}"

  # Step 2: Write + review loop
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
            webResearch: "{{research.web-researcher}}"
            academicResearch: "{{research.academic-researcher}}"
            feedback: "{{editor.feedback}}"
        - ref: editor
          input:
            draft: "{{writer.draft}}"

  # Step 3: Send notification
  - agent:
      id: notify
      kind: tool
      stateKey: notification
      tool:
        kind: local
        name: send_slack
        params:
          channel: "#content"
          message: "New article ready: {{topic}}"

output:
  article: "{{writing.writer.draft}}"
  sources:
    web: "{{research.web-researcher}}"
    academic: "{{research.academic-researcher}}"
  reviewIterations: "{{writing.editor}}"
```

---

## Instruction Templates

Instructions support `{{}}` template syntax for variable interpolation and conditional blocks.

```yaml
instruction: |
  You are a writing assistant. Write about {{topic}} in a {{tone}} tone.

  {{#if feedback}}
  The reviewer provided feedback on your previous draft. Incorporate it:
  {{feedback}}
  {{/if}}

  {{#if language != en}}
  Write your response in {{language}}.
  {{/if}}
```

### Variable interpolation

- `{{varName}}` -- replaced with the resolved state value
- Null values render as empty string

### Conditional blocks

- `{{#if varName}}` ... `{{/if}}` -- truthiness (non-null, non-empty)
- `{{#if varName == value}}` ... `{{/if}}` -- equality
- `{{#if varName != value}}` ... `{{/if}}` -- inequality
- The entire block (including whitespace) is removed when the condition is false

---

## Tools

Tools are declared as an array on the agent. Three kinds:

### MCP tools

```yaml
tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:                           # omit to expose all tools from this server
      - toolA                        # plain, as-is from server
      - toolB
      - tool: search                 # wrapped tool (see below)
        params:
          user_id: "{{userId}}"
```

### Local tools

Registered in the service via API, referenced by name:

```yaml
tools:
  - kind: local
    tools: [calculator, dateFormatter]
```

### Agent-as-tool

Another agent exposed as a callable tool:

```yaml
tools:
  - kind: agent
    agent: researcher
```

### Tool wrapping

Wrap a tool to pin parameters from state, hiding them from the LLM. Optionally override the tool's name and description.

```yaml
tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:
      - toolA
      - toolB
      - tool: search                               # original tool name
        name: search_current_user                  # optional -- LLM sees this name
        description: "Search records by query"     # optional -- LLM sees this description
        params:
          user_id: "{{userId}}"                    # pinned from state, hidden from LLM
```

What happens at runtime:
1. The wrapped params are **removed** from the schema the LLM sees
2. At execution, the pinned values are **injected** from state
3. The LLM sees the overridden name/description if provided

---

## Conditions

Used in `when` (step-level) and `until` (sequential looping). Evaluated against resolved state values.

```yaml
when: "{{language}} != en"                                   # equality
when: "{{feedback}}"                                         # truthiness
until: "{{score}} >= 0.8"                                    # comparison
until: "{{score}} >= 0.8 && {{reviewer.approved}} == true"   # compound
```

**Operators:** `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`

**Truthiness:** non-null, non-empty string, non-zero = true.

---

## Output

### LLM agents: `outputSchema`

Enforces structured output from the model. Properties listed directly (implicit object):

```yaml
outputSchema:
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number
```

### Pipeline agents: `output`

Maps state values to output properties. Optional -- defaults to last step's output (sequential) or all branch outputs keyed by stateKey (parallel).

```yaml
output:
  result: "{{final}}"
  originalResearch: "{{researcher}}"
  translation: "{{translator}}"
```

---

## Error Handling

Pipelines **fail fast**. If any step fails, the entire pipeline fails immediately. No per-step error configuration.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| `inputSchema` vs `input` | `inputSchema` is the agent's contract (what it expects). `input` is the step-level transform (how the caller maps state to it). |
| `outputSchema` vs `output` | `outputSchema` enforces LLM structured output. `output` maps pipeline state to the agent's output. |
| Flat `inputSchema` / `outputSchema` | Implicit object type. No `type: object` / `properties:` boilerplate. |
| No `inputSchema` = string input | Simple agents just take a string, accessible as `{{userQuery}}`. |
| Required but nullable | Every declared input property must be provided, but null is valid (e.g. skipped steps, first loop iteration). |
| No env vars in `{{}}` | Agent definitions are environment-agnostic. Env-specific values are injected at invocation time. |
| No `loop` kind | Sequential with `until` + `maxIterations` covers the same case without a separate kind. |
| Fail fast | Simplest error model. Per-step error handling can be added later if needed. |
| Mixed tools array | Plain strings and wrapped objects coexist in the same `tools` array for a single MCP server. No repeated server URLs. |
