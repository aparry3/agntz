# Context

Context is shared state across agents. A `contextId` is a named scratchpad that agents can read from and optionally write to, enabling multi-agent collaboration without tight coupling.

## Session vs Context vs Run

Three different state primitives, often confused:

| Primitive | What it tracks | Scope |
|---|---|---|
| **[Session](/guide/06-sessions)** | Conversation thread — `Message[]` between user and agent | One agent, multi-turn |
| **Context** (this chapter) | Shared scratchpad agents read from / write to | Many agents, named bucket |
| **[Run](/guide/08-runs)** | One agent invocation — input, output, status, events | One invocation, possibly with children |

Sessions are about *what was said*. Context is about *what we know*. Runs are about *what we did*.

## Basic Usage

```typescript
// Agent 1: Researcher writes findings
await runner.invoke("researcher", "Find info about MCP", {
  contextIds: ["project-alpha"],
});

// Agent 2: Writer reads the same context
await runner.invoke("writer", "Write an article using the research", {
  contextIds: ["project-alpha"],
});
```

## How Context Works

When an agent is invoked with `contextIds`, the runner:

1. Loads entries from the context store for each ID
2. Injects them into the system prompt as structured XML
3. If the agent has `contextWrite: true`, writes the output back to context

### Injection Format

```xml
<context id="project-alpha">
  <entry agent="researcher" time="2026-03-05T10:00:00Z">
    MCP (Model Context Protocol) is a standard for...
  </entry>
</context>
```

## Writing to Context

### Pattern A: Agent Output → Context

Set `contextWrite: true` on the agent definition:

```typescript
const researcher = defineAgent({
  id: "researcher",
  systemPrompt: "Research topics thoroughly...",
  model: { provider: "openai", name: "gpt-5.4" },
  contextWrite: true,  // Output auto-writes to context
});
```

### Pattern B: Application Code → Context

```typescript
await runner.context.add("project-alpha", {
  agentId: "application",
  invocationId: "manual",
  content: "Project requirements: build an AI SDK...",
  createdAt: new Date().toISOString(),
});
```

## Context Limits

```typescript
const runner = createRunner({
  context: {
    maxEntries: 20,       // Max entries per context ID
    maxTokens: 4000,      // Token budget for context injection
    strategy: "latest",   // "latest" | "summary" | "all"
  },
});
```

## Dynamic Context with toolContext

Tools can invoke agents with dynamically constructed context paths:

```typescript
const getWorkout = defineTool({
  name: "get_workout",
  description: "Generate a workout",
  input: z.object({ type: z.string() }),
  async execute(input, ctx) {
    return await ctx.invoke("workout-generator", input.type, {
      contextIds: [
        `users/${ctx.user.id}/fitness`,  // User-specific context
        "global/exercises",               // Shared context
      ],
    });
  },
});
```

## Context API

```typescript
// Read context
const entries = await runner.context.get("project-alpha");

// Add to context
await runner.context.add("project-alpha", { ... });

// Clear context
await runner.context.clear("project-alpha");
```
