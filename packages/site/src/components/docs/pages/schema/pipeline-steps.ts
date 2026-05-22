export default `# Pipeline steps and looping

Fields that apply to the pipeline kinds — \`sequential\` (\`steps:\`) and \`parallel\` (\`branches:\`). Every step is either a \`ref\` to an existing agent or an inline \`agent\` definition; both expose the same set of step-level fields.

## Step shape

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

All agents — including inline ones — require an \`id\`. It's what the trace span is named after, and what \`stateKey\` defaults to.

### \`input\` *(optional)*

Maps parent state into the child's input. Templates resolve against the parent's state.

\`\`\`yaml
- ref: summarizer
  input:
    text: "{{researcher.body}}"
    language: "{{language}}"
\`\`\`

If omitted, the child receives no explicit input. (If the child has an \`inputSchema\` with required fields, that's a load-time error.)

### \`stateKey\` *(optional)*

Renames where the child's output lands in parent state. By default, output lands under the child's \`id\`.

\`\`\`yaml
- ref: researcher
  stateKey: factCheck            # downstream uses {{factCheck}} instead of {{researcher}}
\`\`\`

### \`when\` *(optional)*

Skip the step if the condition is false. When skipped, the step's output is **null** — downstream references like \`{{stepId.property}}\` also resolve to null without throwing.

\`\`\`yaml
- ref: translator
  when: "{{language}} != en"
  input: { text: "{{draft}}", lang: "{{language}}" }
\`\`\`

\`when\` evaluates after templates resolve. See [Templates and conditions](/docs/schema/templates-conditions) for operator syntax.

## Looping (\`sequential\` only)

Set \`until\` at the pipeline level (not on a step) to repeat the step list until a condition holds. \`maxIterations\` is the safety stop.

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

Loop semantics:

- Steps run in declared order each iteration.
- \`until\` is checked **after** each full pass; the loop exits when it's true.
- State carries over between iterations — each iteration sees the previous one's outputs at \`{{stepId.property}}\`.
- On the first iteration, references to outputs that haven't been computed yet resolve to **null**.
- \`maxIterations\` is required when \`until\` is set; the loop fails fast if exceeded.

## Branches (\`parallel\` only)

\`branches\` look identical to \`steps\` but run concurrently. There's no \`until\` or \`when\` at the parallel level — branches always run unconditionally. Use \`when\` on individual branches to gate them.

\`\`\`yaml
id: text-analysis
kind: parallel

inputSchema:
  text: string

branches:
  - ref: sentiment-analyzer
    input: { text: "{{text}}" }
  - ref: entity-extractor
    input: { text: "{{text}}" }
    when: "{{text}}"               # skip if text is empty
\`\`\`

If no \`output:\` is declared, the result is the merged outputs of all branches keyed by their \`id\` (or \`stateKey\`).

## Error handling

Pipelines **fail fast**. If any step fails, the entire pipeline fails immediately. There's no per-step retry config in the manifest — handle retries at the caller level via run options or wrap the pipeline in code:

\`\`\`ts
try {
  await client.agents.run({ agentId: "my-pipeline", input });
} catch (err) {
  if (err.code === "TOOL_TIMEOUT") {
    // retry, log, escalate, ...
  }
}
\`\`\`

A failed step's error is captured in the trace and surfaces in \`runs.list({ status: "error" })\`.
`;
