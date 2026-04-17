# Agent Chains

agntz supports multi-agent collaboration through two mechanisms: **agent-as-tool** references and **tool-driven chains** with dynamic context.

## Agent-as-Tool

The simplest way to chain agents — declare one agent as a tool for another:

```typescript
runner.registerAgent(defineAgent({
  id: "researcher",
  name: "Researcher",
  systemPrompt: "Research topics thoroughly...",
  model: { provider: "openai", name: "gpt-5.4" },
  tools: [{ type: "mcp", server: "web-search" }],
}));

runner.registerAgent(defineAgent({
  id: "writer",
  name: "Writer",
  systemPrompt: "Write articles using available research...",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [
    { type: "agent", agentId: "researcher" },  // Can call researcher
  ],
}));

// Writer can invoke researcher as a tool during execution
await runner.invoke("writer", "Write about MCP");
```

## Recursion Limits

Agent chains can recurse (A calls B calls A). agntz tracks depth and enforces limits:

```typescript
const runner = createRunner({
  defaults: {
    maxRecursionDepth: 3,  // Default is 3
  },
});
```

If the limit is exceeded, the invocation throws a `MaxRecursionError`.

## Tool-Driven Chains

For more control, use tools that explicitly invoke other agents:

```typescript
const updateFitness = defineTool({
  name: "update_fitness",
  description: "Update fitness profile",
  input: z.object({ updates: z.record(z.unknown()) }),
  async execute(input, ctx) {
    // Invoke a specialized agent with different context
    return await ctx.invoke("fitness-updater", JSON.stringify(input.updates), {
      contextIds: [`users/${ctx.user.id}/fitness`],
      toolContext: { user: ctx.user },
    });
  },
});
```

### Why Tool-Driven Chains?

- **Dynamic context** — construct context IDs at runtime
- **Explicit data flow** — control what each agent sees
- **Different options** — each sub-invocation gets its own session, context, etc.

## Context Sharing

Agents can share state through the context system:

```typescript
// Researcher writes to shared context
await runner.invoke("researcher", "Find info about MCP", {
  contextIds: ["project"],
});

// Writer reads the same context
await runner.invoke("writer", "Write the article", {
  contextIds: ["project"],
});
```

See [Context](/guide/context) for details on the context system.
