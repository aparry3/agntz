export default `# Defining agents

Agents are declared in YAML manifests. The file's \`id\` is the agent's identifier; \`kind\` selects one of four agent types. The same manifest runs unchanged in embedded mode, hosted mode, and self-hosted mode.

## Anatomy of a manifest

\`\`\`yaml [agents/sentiment-analyzer.yaml]
id: sentiment-analyzer            # required, unique within the registry
name: Sentiment Analyzer          # optional, display label
description: Tags text positive/negative/neutral
kind: llm                         # llm | tool | sequential | parallel

inputSchema:                      # optional — what the agent expects
  text: string

model:                            # required for kind: llm
  provider: openai
  name: gpt-5.4-nano
  temperature: 0

instruction: |                    # required for kind: llm — the system prompt
  Analyze the sentiment of the following text and respond with a JSON object.

  Text: {{text}}

outputSchema:                     # optional — what the model must return
  sentiment:
    type: string
    enum: [positive, negative, neutral]
  confidence: number
\`\`\`

A manifest is just data — there's no code to maintain alongside it. The runner validates it on load, registers it with the runtime, and exposes it through the same \`client.agents.run\` API regardless of where it runs.

## Read next

- **[The four agent kinds](/docs/concepts/agent-kinds)** — \`llm\`, \`tool\`, \`sequential\`, \`parallel\`, with examples of each.
- **[Common fields](/docs/schema/common-fields)** — \`id\`, \`name\`, \`kind\`, and the fields every agent shares.
- **[Input, state, and output](/docs/schema/input-state-output)** — how data flows into and out of an agent.
- **[Templates and conditions](/docs/schema/templates-conditions)** — the \`{{}}\` mini-language used in instructions, params, and \`when\`/\`until\`.
`;
