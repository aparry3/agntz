export default `# Agent-as-tool

Expose another agent as a callable tool. The parent LLM decides when to delegate, and the child agent runs as a nested span in the parent's trace.

\`\`\`yaml
tools:
  - kind: agent
    agent: researcher
\`\`\`

The model sees a tool with the child agent's \`name\` and \`description\`, parameters derived from its \`inputSchema\`, and a return type derived from its \`outputSchema\`.

When the model calls the tool, the child agent runs to completion — model calls, tool calls, sub-pipelines and all — and the child's output is returned to the parent model. The child's trace appears nested under the parent's, complete with its own \`model.call\` and \`tool.execute\` spans.

## When to use

- **Decomposition.** Break a complex task into specialist agents and let the orchestrator delegate.
- **Reuse.** A research agent used in three different workflows is exactly that — three pipelines, one agent.
- **Boundary.** Use a child agent as the boundary between a planning LLM (which decides what to do) and a doing LLM (which executes with a different model, instruction, or toolset).

## Versus spawnable

[Spawnable](/docs/schema/skills-spawnable-reply#spawnable) and agent-as-tool look similar but differ in two ways:

| Feature | agent-as-tool | spawnable |
|---|---|---|
| Concurrency | Sequential — model calls tool, waits | Concurrent — \`spawn_agent({ id, ... })\` fires off multiple in parallel |
| Granularity | One specific agent per tool | A list of allowed agents the model can pick from |

Use agent-as-tool when there's a clear "specialist" being called; use spawnable when you want fan-out (e.g. fact-check multiple claims at once).

## Tool wrapping

For MCP and HTTP tools — not agent-as-tool — you can pin parameters from state. They're injected at execution and hidden from the LLM's schema. This is how you ground tools in per-invocation context (user id, tenant id, secrets) without trusting the model to pass them.

\`\`\`yaml
tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:
      - tool: search
        name: search_current_user      # optional rename
        description: "Search the current user's records"
        params:
          user_id: "{{userId}}"        # state-templated, hidden
\`\`\`

See [MCP tools](/docs/tools/mcp#wrapping-a-tool) and [HTTP tools](/docs/tools/http#url-placeholder-syntax) for details.
`;
