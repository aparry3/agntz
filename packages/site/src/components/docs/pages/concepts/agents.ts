export default `# Defining agents

Agents are declared in YAML manifests. The file's \`id\` is the agent's
identifier; \`kind\` selects one of six agent types. LLM, tool, sequential, and
parallel manifests are portable across embedded and hosted runtimes.
Transcription and image manifests run on hosted or self-hosted workers with a
matching operation adapter.

## Anatomy of a manifest

\`\`\`yaml [agents/sentiment-analyzer.yaml]
id: sentiment-analyzer            # required, unique within the registry
name: Sentiment Analyzer          # optional, display label
description: Tags text positive/negative/neutral
kind: llm                         # llm | transcription | image | tool | sequential | parallel

inputSchema:                      # optional — what the agent expects
  type: object
  properties:
    text: { type: string }
  required: [text]
  additionalProperties: false

model:                            # required for kind: llm
  provider: openai
  name: gpt-5.4-nano
  temperature: 0

instruction: |                    # required for kind: llm — the system prompt
  Analyze the sentiment of the following text and respond with a JSON object.

  Text: {{text}}

outputSchema:                     # optional — what the model must return
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

A manifest is just data — there's no code to maintain alongside it. The runner validates it on load, registers it with the runtime, and exposes it through the same \`client.agents.run\` API regardless of where it runs.

## Read next

- **[The six agent kinds](/docs/concepts/agent-kinds)** — model operations,
  deterministic tools, and composed pipelines.
- **[Common fields](/docs/schema/common-fields)** — \`id\`, \`name\`, \`kind\`, and the fields every agent shares.
- **[Input, state, and output](/docs/schema/input-state-output)** — how data flows into and out of an agent.
- **[Templates and conditions](/docs/schema/templates-conditions)** — the \`{{}}\` mini-language used in instructions, params, and \`when\`/\`until\`.
- **[Provider replacement](/docs/hosted/provider-replacement)** — use the
  hosted run API instead of a provider-specific SDK call.
`;
