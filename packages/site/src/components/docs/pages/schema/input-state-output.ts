export default `# Input, state, and output

How data flows into and out of an agent. The same model applies to every \`kind\` — primitives consume their input, pipelines merge per-step outputs into a shared state object, and the agent's final result is shaped by \`outputSchema\` (LLM) or \`output\` (pipelines).

## Canonical JSON Schema

\`inputSchema\`, \`outputSchema\`, and callback-tool \`inputSchema\` use JSON
Schema Draft 2020-12. New manifests should use an object-root schema:

\`\`\`yaml [agents/search.yaml]
inputSchema:
  type: object
  properties:
    query:
      type: string
      minLength: 1
    filters:
      type: object
      properties:
        tags:
          type: array
          items: { type: string }
        maxMinutes:
          type: [integer, "null"]
          minimum: 1
      required: [tags]
      additionalProperties: false
  required: [query, filters]
  additionalProperties: false
\`\`\`

Supported vocabulary includes nested objects and arrays, \`required\`,
\`additionalProperties\`, nullable type unions, \`enum\`, \`const\`, numeric
limits, string and array constraints, composition keywords, and local
\`#/$defs\` references. Remote \`$ref\` URLs are rejected. Schemas are capped
at 256 KiB encoded and 64 levels of nesting.

Agntz validates schema definitions when manifests are imported and reports
JSON Pointer paths for invalid definitions. Input values are validated before
execution. Structured model output is constrained at the provider and validated
again before it is returned.

The published complete manifest schema is available at
\`https://agntz.co/schemas/agent-manifest.schema.json\` and from the
\`@agntz/core/schema\` package export.

### Legacy property-map shorthand

Existing manifests remain valid:

\`\`\`yaml
inputSchema:
  query: string
  language:
    type: string
    default: en
\`\`\`

Agntz migrates this shorthand to a strict object schema with every listed field
required and \`additionalProperties: false\`. Use canonical JSON Schema when
fields are optional, nested, nullable, or shared through \`$defs\`.

## Input

If \`inputSchema\` is omitted, an LLM agent accepts a plain string accessible as
\`{{userQuery}}\`. A canonical input object exposes its root properties to
templates by name.

### Model config (LLM kind only)

\`\`\`yaml
model:
  provider: openai
  name: gpt-5.4
  temperature: 0.7
  maxTokens: 4096
  topP: 0.95
  maxRetries: 2
\`\`\`

See [Models and providers](/docs/models#common-model-controls) for every common
field and provider-scoped \`providerOptions\`.

### Instruction and prompt (LLM kind only)

\`\`\`yaml
instruction: |               # required — the system prompt
  You are a math tutor. Explain each step clearly.

prompt: |                    # optional — user-message template
  Solve carefully: {{userQuery}}
\`\`\`

- **\`instruction\`** is the system prompt. Templated with \`{{}}\` against state.
- **\`prompt\`** is the user message. When absent, the agent's raw input (\`{{userQuery}}\` or the input object stringified) is sent verbatim.

Splitting them lets the system prompt remain stable (and cache-friendly with providers that cache by prefix), while the user-message template changes per call.

## State

State is the working memory that pipeline steps share. It's a flat object scoped per agent — **sub-agents have their own state and cannot see the parent's**.

\`\`\`
{
  ...input,                                              # input properties at root
  [stateKey ?? normalizeId(subAgent)]: subAgentOutput    # per sub-agent
}
\`\`\`

Rules:

- \`{{varName}}\` references root input properties.
- \`{{agentId.property}}\` references a sub-agent's output property.
- \`{{stateKey}}\` references the entire output of a sub-agent (when \`outputSchema\` makes it a structured object) or its raw output.
- Unresolved references (skipped steps, first loop iteration) resolve to **null** — they don't throw.

\`stateKey\` lets you rename where a step's output lands. By default it lands under the sub-agent's id; \`stateKey: writing\` renames it for ergonomic downstream references.

## Output

### LLM agents — \`outputSchema\`

Constrains the model's response to a JSON object. The runner enforces the schema and returns parsed JSON, not a string.

\`\`\`yaml
outputSchema:
  type: object
  properties:
    sentiment:
      type: string
      enum: [positive, negative, neutral]
    confidence:
      type: number
      minimum: 0
      maximum: 1
  required: [sentiment, confidence]
  additionalProperties: false
\`\`\`

\`\`\`ts
const { output } = await client.agents.run({
  agentId: "sentiment-analyzer",
  input: { text: "I love this!" },
});
// output = { sentiment: "positive", confidence: 0.95 }
\`\`\`

Without \`outputSchema\`, the agent returns the model's raw text.

### Pipeline agents — \`output\`

Pipeline agents use \`output\` to map state to the result. Optional — defaults to the last step's output (sequential) or all branch outputs keyed by id (parallel).

\`\`\`yaml
output:
  article: "{{writing.writer.draft}}"
  review: "{{writing.editor}}"
\`\`\`

Anything in state is fair game — \`output\` is just a template substitution map.

## Examples (LLM kind)

Few-shot examples improve consistency. They're injected into the prompt before the user message.

\`\`\`yaml
examples:
  - input: "I absolutely love this product!"
    output: '{"sentiment": "positive", "confidence": 0.95}'
  - input: "The package arrived on Tuesday."
    output: '{"sentiment": "neutral", "confidence": 0.88}'
\`\`\`

When the agent has an \`outputSchema\`, examples should produce JSON that
matches it. Treat the schema as the transport contract and continue to enforce
domain invariants—such as known database ids or row counts—in application code.
`;
