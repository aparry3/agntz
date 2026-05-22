export default `# Skills, spawnable, reply

Three optional fields available only on \`kind: llm\` agents. Each exposes a different runtime capability to the model — mid-run skill loading, concurrent sub-agents, and streaming intermediate messages.

## Skills

Named skill bundles the agent may load mid-run via the synthetic \`use_skill\` tool. The model decides when (and whether) to load them, based on the task at hand.

\`\`\`yaml
skills:
  - citation-style
  - markdown-rendering
\`\`\`

Rules:

- Skill names must match \`^[a-z][a-z0-9-]*$\`.
- Names resolve against the runtime's **SkillStore** — same store you configure in \`agntz({ skills: ... })\` (embedded) or in **Settings → Skills** (hosted).
- The model sees skill names + descriptions in its tool list; it can call \`use_skill\` to pull a skill's full instructions into context.
- Calling a skill twice is a no-op — the runtime tracks what's loaded.

Skills are how you split very large instructions into reusable bundles without inflating every prompt. The model loads only what it actually needs.

## Spawnable

Sub-agents the LLM may spawn concurrently at runtime via the synthetic \`spawn_agent\` tool. Predefined per agent — **the LLM cannot invent agents**, only invoke the ones you list.

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

Rules:

- \`kind: ref\` — reference an existing agent by id.
- \`kind: inline\` — define the sub-agent inline. Must itself be \`kind: llm\` with a **static** (non-templated) instruction.
- The model sees the spawnable agents in its tool list and calls \`spawn_agent({ id, input })\` to invoke one.
- Spawned agents run in parallel with the parent; each gets its own state and its own trace span nested under the parent.

Use spawnable when you want the model to fan out work it identifies during execution — for example, fact-checking each claim in a draft.

## Reply

Register a per-invocation \`reply\` tool the model can call to deliver intermediate messages. Replies surface as SSE events on streaming endpoints, so your UI can show progress before the final answer.

\`\`\`yaml
reply: true                  # defaults: maxPerRun = 50

# or
reply:
  maxPerRun: 5
\`\`\`

The model sees a tool called \`reply\` with a single string parameter; calling it emits a \`reply\` event in the run's stream. Pair with \`client.agents.stream(...)\` to surface progress to a user:

\`\`\`ts
for await (const event of client.agents.stream({
  agentId: "long-task",
  input: { ... },
})) {
  if (event.type === "reply") ui.append(event.text);
  if (event.type === "complete") ui.finalize(event.output);
}
\`\`\`

Replies are stored on the session alongside messages, so when a session resumes the model can see what it told the user previously.

## Compatibility

All three fields work in **embedded** and **hosted** mode. \`spawn_agent\` and \`use_skill\` are synthetic tools — the runtime injects them; you don't need to declare them under \`tools:\`.
`;
