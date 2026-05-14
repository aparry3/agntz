# Tools

Tools give agents the ability to interact with the outside world. agntz supports three tool sources: **inline tools** (defined in code), **MCP tools** (from MCP servers), and **agent tools** (other agents).

## Defining Inline Tools

```typescript
import { defineTool } from "agntz";
import { z } from "zod";

const lookupOrder = defineTool({
  name: "lookup_order",
  description: "Look up an order by ID or customer email",
  input: z.object({
    orderId: z.string().optional().describe("Order ID"),
    email: z.string().email().optional().describe("Customer email"),
  }),
  async execute(input, ctx) {
    const order = await db.orders.find(input);
    return { order };
  },
});
```

### Key Points

- **`input`** uses Zod schemas — auto-converted to JSON Schema for the model
- **`execute`** receives validated input and a `ToolContext`
- **Return value** is serialized to JSON and sent back to the model

## Tool Context

Every tool's `execute()` receives a context object:

```typescript
async execute(input, ctx) {
  ctx.agentId;        // Which agent is running
  ctx.sessionId;      // Session ID (if conversational)
  ctx.contextIds;     // Active context buckets
  ctx.invocationId;   // Unique ID for this invocation
  ctx.invoke();       // Call another agent from this tool

  // Plus any runtime data from toolContext:
  ctx.user;           // From invoke({ toolContext: { user: ... } })
}
```

### Passing Runtime Data via `toolContext`

```typescript
// Application code
await runner.invoke("support", "Help me with my order", {
  toolContext: {
    user: { id: "u_123", email: "aaron@example.com" },
    requestId: "req_abc",
  },
});

// Inside the tool — toolContext is spread into ctx
const lookupOrder = defineTool({
  name: "lookup_order",
  input: z.object({}),
  description: "Look up orders for the current user",
  async execute(input, ctx) {
    // ctx.user is available — no need to ask the model
    return await db.orders.findByEmail(ctx.user.email);
  },
});
```

### Type-Safe Tool Context

```typescript
interface MyContext {
  user: { id: string; email: string };
}

const lookupOrder = defineTool<MyContext>({
  name: "lookup_order",
  description: "Look up orders",
  input: z.object({}),
  async execute(input, ctx) {
    ctx.user.email; // ← TypeScript knows the type
  },
});
```

## Registering Tools

```typescript
const runner = createRunner({
  tools: [lookupOrder, refundOrder, getTime],
});

// Or register after creation
runner.registerTool(lookupOrder);
```

## Tool Registry

All tools — inline, MCP, agent — end up in a single registry:

```typescript
// List all available tools
const tools = runner.tools.list();
// → [{ name: "lookup_order", source: "inline", ... }, ...]

// Get a specific tool
const tool = runner.tools.get("lookup_order");

// Execute directly (for testing)
const result = await runner.tools.execute("lookup_order", { orderId: "123" });
```

## MCP Tools

Connect to MCP servers to discover and use their tools:

```typescript
const runner = createRunner({
  mcp: {
    servers: {
      github: { url: "http://localhost:3001/mcp" },
      filesystem: {
        command: "npx",
        args: ["-y", "@anthropic/mcp-fs"],
        env: { ROOT: "/data" },
      },
    },
  },
});
```

Reference MCP tools in agent definitions:

```typescript
defineAgent({
  tools: [
    { type: "mcp", server: "github" },                          // All tools
    { type: "mcp", server: "github", tools: ["create_issue"] }, // Specific tools
  ],
});
```

## Agent-as-Tool

Use one agent as a tool for another:

```typescript
defineAgent({
  id: "writer",
  tools: [
    { type: "agent", agentId: "researcher" }, // Writer can call researcher
  ],
});
```

When the writer invokes the researcher tool, agntz calls `runner.invoke("researcher", ...)` internally.

## Tool-Driven Agent Chains

The most powerful pattern — tools that invoke agents with dynamic context:

```typescript
const updateFitness = defineTool({
  name: "update_fitness",
  description: "Update user fitness profile",
  input: z.object({ updates: z.record(z.unknown()) }),
  async execute(input, ctx) {
    return await ctx.invoke("fitness-updater", JSON.stringify(input.updates), {
      contextIds: [`users/${ctx.user.id}/fitness`],
      toolContext: { user: ctx.user },
    });
  },
});
```

::: warning toolContext Does Not Auto-Propagate
When a tool calls `ctx.invoke()`, the child agent does NOT inherit the parent's `toolContext`. You must explicitly pass what the child needs. This is intentional — it prevents accidental data leakage across agent boundaries.
:::

## Synthetic Tools

In addition to the three tool sources above, the runner auto-registers **synthetic tools** for agents that declare certain fields. The LLM sees them like any other tool, but they exist only for the lifetime of one invocation and are constrained at runtime to the agent's allowlists.

### `use_skill` — load a skill mid-run

Registered automatically when `AgentDefinition.skills: string[]` is non-empty. Lets the LLM load a named skill's instructions + tools on demand. The Zod input enum constrains the `skill` argument to exactly the names the agent declared:

```typescript
input: z.object({
  skill: z.enum(["citation-style", "summarization"]),
})
```

When called, it (a) returns the skill's `instructions` to the model, and (b) registers the skill's `tools` into the live registry for the rest of the run. Idempotent — a second call for the same skill returns `{ alreadyLoaded: true }`. See [the Skills chapter](/guide/05-skills).

### `spawn_agent` — kick off a concurrent sub-agent

Registered when `AgentDefinition.spawnable: AgentRef[]` is non-empty. Lets the LLM spawn a child Run that executes concurrently with the parent. Returns a `RunHandle` immediately — the child's output is delivered to the parent's next turn via the run registry.

```typescript
input: z.object({
  agent_id: z.enum(["researcher", "fact-checker"]),  // allowlist
  input: z.string(),
})
```

Limits (`packages/core/src/tools/spawn-agent.ts:23-27`): `maxConcurrentChildren = 8`, `maxDepth = 5`, `maxDescendants = 50`. See [the Runs chapter](/guide/08-runs) for the lifecycle.

### `check_agents` — poll status of spawned children

Registered alongside `spawn_agent`. Returns the current status of the parent's spawned children. Useful for polling mid-thought; not strictly necessary, since completed children are delivered automatically as notifications between turns.

```typescript
input: z.object({
  run_ids: z.array(z.string()).optional(),  // omit to query all children
})
```

### Why synthetic vs ordinary tools?

The Zod enum approach ensures the LLM **cannot call these tools for off-list names** — wrong skill or agent names fail validation before `execute` runs. This is defense-in-depth on top of the agent definition's allowlist.

| Field on `AgentDefinition` | Synthetic tools added |
|---|---|
| `skills: [...]` | `use_skill` |
| `spawnable: [...]` | `spawn_agent`, `check_agents` |

See `packages/core/src/tools/use-skill.ts` and `packages/core/src/tools/spawn-agent.ts` for the implementations.
