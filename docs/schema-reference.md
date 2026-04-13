# Agent Runner YAML Schema Reference

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

## State

State is scoped per agent. Shape: `{ ...input, [stateKey]: subAgentOutput }`.

- `{{varName}}` — references an input property
- `{{agentId.property}}` — references a sub-agent's output
- Null values: skipped steps and first loop iterations resolve to null

### stateKey

Override where a step's output lands in parent state:

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
  name: gpt-4o
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

# Optional: tools available to the LLM
tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:
      - search
      - tool: fetch            # wrapped tool
        name: fetch_for_user
        description: "Fetch URL"
        params:
          api_key: "{{apiKey}}"  # pinned from state, hidden from LLM
  - kind: local
    tools: [calculator]
  - kind: agent
    agent: helper-agent
```

### Tool wrapping

Pin parameters from state. The LLM sees a modified schema without the pinned params:

```yaml
tools:
  - kind: mcp
    server: https://api.example.com/mcp
    tools:
      - plain_tool                   # as-is
      - tool: search                 # original name
        name: search_current_user    # optional: LLM sees this name
        description: "Search by query"  # optional: LLM sees this
        params:
          user_id: "{{userId}}"      # pinned, removed from LLM schema
```

## Tool Agent

Deterministic function call. No LLM involved.

```yaml
id: send-email
kind: tool

inputSchema:
  to: string
  subject: string
  body: string

tool:
  kind: mcp              # or local
  server: https://email.example.com/mcp
  name: send_email
  params:
    to: "{{to}}"
    subject: "{{subject}}"
    body: "{{body}}"
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
      model:
        provider: openai
        name: gpt-4o
      instruction: "Summarize: {{researcher}}"
      outputSchema:
        summary: string

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
      model:
        provider: openai
        name: gpt-4o
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
      model:
        provider: openai
        name: gpt-4o
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
      model:
        provider: openai
        name: gpt-4o
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
5. Template `{{}}` references state only — no env vars
6. Skipped steps (via `when`) produce null output
7. Pipelines fail fast — any step failure stops the pipeline
8. `outputSchema` is for LLM structured output; `output` is for pipeline state mapping
