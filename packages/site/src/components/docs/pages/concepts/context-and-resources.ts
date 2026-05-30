export default `# Context and resources

agntz has two different "context" surfaces. They solve different problems and should not be used interchangeably.

| Surface | What it means | Who can set it | What sees it |
|---|---|---|---|
| \`context\` | Runtime namespace grants for resources such as memory, RAG, and files | Trusted application or worker code | Resource providers and tool context |
| \`contextIds\` | Legacy scratchpad bucket ids backed by \`ContextStore\` | Application code invoking the runner | The prompt, as injected scratchpad text |
| Session | Conversation message history | Runtime and client through \`sessionId\` | The model conversation |
| State | One pipeline invocation's working object | Manifest execution | Pipeline steps and templates |
| Run | One invocation record with status and events | Runtime | Runs API and traces |

Use \`context\` for access control boundaries. Use \`contextIds\` only when you explicitly want the older shared scratchpad behavior.

## Namespace grants

A namespace grant is a plain path string that says which branch of a resource tree this run may access.

\`\`\`ts {group=context-run}
await client.agents.run({
  agentId: "support-with-memory",
  input: "Remember that I prefer metric units.",
  context: ["app/user/" + userId],
});
\`\`\`

\`\`\`python {group=context-run}
client.agents.run(
    agent_id="support-with-memory",
    input="Remember that I prefer metric units.",
    context=[f"app/user/{user_id}"],
)
\`\`\`

Grant strings are intentionally strict:

- No leading or trailing slash.
- No empty path segments.
- No \`.\` or \`..\` traversal segments.
- No wildcards.
- No whitespace in any segment.
- Duplicates are removed after validation.

The model should never be asked to choose a namespace. Trusted code mints grants from authenticated facts such as user id, workspace id, tenant id, or service identity. Resource providers receive normalized grants through \`ResourceToolContext.grants\`.

## Narrow-only propagation

Child invocations inherit the parent's grants unless trusted code requests a narrower descendant grant.

\`\`\`ts
await ctx.invoke("account-helper", "Check invoice details", {
  context: ["app/user/" + userId + "/billing"],
});
\`\`\`

That is allowed only when the parent already has \`app/user/&lt;id&gt;\` or another ancestor of the requested child grant. A child cannot widen from \`app/user/u_123/billing\` to \`app/user/u_123\`, and it cannot jump sideways to \`app/user/u_456\`.

## Resources

Resources are named runtime capabilities declared in an LLM agent manifest. A declaration says which provider kind the agent wants, whether it needs read or write tools, and any provider-specific config.

\`\`\`yaml
id: support-with-memory
kind: llm
model:
  provider: openai
  name: gpt-5.4
instruction: |
  Help the user. Use memory only when it is relevant.
resources:
  memory:
    mode: read-write
    autoScan: true
\`\`\`

The runner looks up a provider by resource \`kind\`. If \`kind\` is omitted, it defaults to the resource name. Provider tools are exposed to the model with names like \`memory_read\` and \`memory_write\`.

The resource declaration does not grant access by itself. Access comes from the run's \`context\` grants.

## Resource provider lifecycle

For each run, the runtime:

1. Validates and normalizes \`context\` namespace grants.
2. Resolves the agent's \`resources:\` declarations against registered providers.
3. Lets providers inject extra context, such as a list of visible memory topics.
4. Registers provider tools for the model with generated names.
5. Passes \`ResourceToolContext\` to each provider tool call.

Resource providers must still validate every read and write against the grants they receive. Namespace paths are capabilities, not suggestions.

## Read versus read-write

Resources support two modes:

| Mode | Behavior |
|---|---|
| \`read\` | The model receives only read-safe provider tools. |
| \`read-write\` | The model may receive read and write provider tools. |

If a parent invocation runs a resource in \`read\` mode, child invocations cannot widen it back to \`read-write\`. This keeps delegated work inside the parent's access boundary.

## Legacy scratchpad context

\`contextIds\` are the older shared scratchpad API. When you pass them, the runner loads text entries from \`ContextStore\` and injects them into the prompt.

\`\`\`ts
await runner.invoke("researcher", "Find docs about MCP", {
  contextIds: ["project-alpha"],
});
\`\`\`

If the agent has \`contextWrite: true\`, its final output is written back to each context bucket. This is useful for simple multi-agent scratchpads, but it is not a security boundary and it is not how resource access is granted.

## Where to go next

- **[Resources schema](/docs/schema/resources)** - every field in the \`resources:\` block.
- **[Memory with memrez](/docs/tools/memory-memrez)** - durable memory as the first resource provider.
- **[Sessions](/docs/concepts/sessions)** - conversation history across calls.
`;
