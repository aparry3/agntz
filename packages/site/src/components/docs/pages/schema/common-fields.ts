export default `# Common fields

Every agent manifest starts with the same four-field header, regardless of kind. These are the identity fields surfaced everywhere — in the trace, the runs list, the agent picker, and (on the hosted edition) the version history.

\`\`\`yaml
id: my-agent                          # required, unique within the registry
name: My Agent                        # optional, display label
description: Does a thing             # optional, surfaced in UIs
kind: llm                             # llm | tool | sequential | parallel
\`\`\`

## Field reference

### \`id\` *(required)*

The agent's stable identifier. It's what you pass to \`client.agents.run({ agentId })\`, what appears in trace spans, and what other agents reference with \`ref:\`.

- Must match \`^[a-z][a-z0-9-]*$\` — lowercase letters, digits, and hyphens.
- Unique within a registry (\`./agents\` directory for embedded, your workspace for hosted).
- **Inline agents inside pipelines still need an \`id\`.** It's what the trace span is named after.

### \`name\` *(optional)*

A human-readable label. Shown in the hosted UI, the embedded \`runs.list\` output, and trace titles. Defaults to a title-cased version of \`id\`.

### \`description\` *(optional)*

Free-form description. Surfaced in the agent picker and used by some tools (e.g. the [agent-as-tool](/docs/tools/agent-as-tool) kind passes it to the parent LLM as the tool's description). Keep it tight — one sentence beats three.

### \`kind\` *(required)*

Selects the agent type:

| Value | Behavior | Required fields |
|---|---|---|
| \`llm\` | Single language-model call | \`model\`, \`instruction\` |
| \`tool\` | Deterministic tool call, no model | \`tool\` |
| \`sequential\` | Run \`steps\` in order; optionally loops with \`until\` | \`steps\` |
| \`parallel\` | Run \`branches\` simultaneously, merge outputs | \`branches\` |

See [The four agent kinds](/docs/concepts/agent-kinds) for examples.

## Where to go next

- **[Input, state, and output](/docs/schema/input-state-output)** — how data flows in and out.
- **[Templates and conditions](/docs/schema/templates-conditions)** — the \`{{}}\` mini-language used in nearly every field.
- **[Pipeline steps and looping](/docs/schema/pipeline-steps)** — fields specific to \`sequential\` and \`parallel\` kinds.
- **[Skills, spawnable, reply](/docs/schema/skills-spawnable-reply)** — extra fields for \`llm\` kind.
`;
