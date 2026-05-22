export default `# Input, state, and output

How data flows into and out of an agent. The same model applies to every \`kind\` — primitives consume their input, pipelines merge per-step outputs into a shared state object, and the agent's final result is shaped by \`outputSchema\` (LLM) or \`output\` (pipelines).

## Input

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

Shorthand: \`name: string\` is equivalent to \`name: { type: string }\`. Supported types are \`string\`, \`number\`, \`boolean\`, \`object\`, and \`array\`. Use \`enum\` to restrict string values; use \`default\` to fall back when the caller omits the field.

If \`inputSchema\` is omitted, the agent accepts a plain string, accessible in templates as \`{{userQuery}}\`.

### Model config (LLM kind only)

\`\`\`yaml
model:
  provider: openai            # openai | anthropic | google | mistral
  name: gpt-5.4
  temperature: 0.7            # optional
  maxTokens: 4096             # optional
  topP: 1.0                   # optional
\`\`\`

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
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number
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

When the agent has an \`outputSchema\`, examples should produce JSON that matches it.
`;
