# What is agntz?

**agntz** is an open-source TypeScript SDK for defining, running, and evaluating AI agents. It treats agents as portable, self-contained data structures — not code — that can be stored, versioned, shared, and loaded from any backing store.

## The Problem

Building AI agents in TypeScript today requires choosing between:

- **Heavy frameworks** (LangChain, Mastra) — opinionated, hard to debug, lock you into their abstractions
- **Provider-specific SDKs** (OpenAI Agents SDK) — lightweight but tied to one provider
- **UI-first platforms** (Vercel AI SDK) — great for streaming but not focused on agent definition or evaluation
- **Rolling your own** — maximum flexibility, zero reuse, no tooling

None solve these problems simultaneously:

1. **Agent-as-config** — serialize, version, and share agent definitions
2. **Bring-your-own storage** — plug in your own persistence
3. **MCP-native tooling** — first-class Model Context Protocol support
4. **Shared context** — multi-agent systems with shared state
5. **Built-in evaluation** — test your agents, not just your code

## The Solution

agntz is organized around three activities:

| Activity | Code | Studio |
|----------|------|--------|
| **Running** | `createRunner()` → `invoke()` | — |
| **Defining** | `defineAgent()` + `defineTool()` | Agent Editor + Tool Catalog |
| **Testing** | `runner.eval()` | Evals Dashboard + Playground |

Running is code-only. Defining and Testing work in both code and the Studio. This keeps the production runtime minimal while providing a rich development experience.

## Key Principles

### Agents are Data

An agent definition is a plain JSON object:

```typescript
{
  id: "support",
  name: "Support Agent",
  systemPrompt: "You are a helpful support agent...",
  model: { provider: "openai", name: "gpt-5.4" },
  tools: [{ type: "inline", name: "lookup_order" }],
}
```

No classes. No inheritance. No decorators. Just data you can store anywhere.

### Pluggable Storage

Every persistence concern has its own interface. Use the built-in stores or bring your own:

```typescript
// Simple: JSON files for everything
const runner = createRunner({
  store: new JsonFileStore("./data"),
});

// Advanced: split by concern
const runner = createRunner({
  agentStore: new PostgresAgentStore(pool),
  sessionStore: new RedisSessionStore(redis),
});
```

### MCP First-Class

MCP servers are a primary tool source, not an afterthought:

```typescript
const runner = createRunner({
  mcp: {
    servers: {
      github: { url: "http://localhost:3001/mcp" },
    },
  },
});
```

### SDK with a Studio

Like Prisma Studio for databases, agntz includes a visual development UI:

```bash
npx agntz studio
```

The Studio reads from the same stores as your code — create an agent in the UI, and it's immediately available to `runner.invoke()`.

## Comparison

| Feature | agntz | LangChain | Vercel AI SDK | OpenAI Agents |
|---------|-------------|-----------|---------------|---------------|
| Agent-as-config | ✅ | ❌ | ❌ | ❌ |
| Pluggable storage | ✅ | Partial | ❌ | ❌ |
| MCP native | ✅ | Bolt-on | ❌ | ❌ |
| Built-in evals | ✅ | ❌ | ❌ | ❌ |
| Studio UI | ✅ | ❌ | ❌ | ❌ |
| Provider agnostic | ✅ | ✅ | ✅ | ❌ |
| Lightweight | ✅ | ❌ | ✅ | ✅ |
