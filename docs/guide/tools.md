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
