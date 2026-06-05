# What is agntz?

**agntz** is an open-source TypeScript SDK for defining and running AI agents. It treats agents as portable, self-contained data structures — not code — that can be stored, versioned, shared, and loaded from any backing store.

## The Problem

Building AI agents in TypeScript today requires choosing between:

- **Heavy frameworks** (LangChain, Mastra) — opinionated, hard to debug, lock you into their abstractions
- **Provider-specific SDKs** (OpenAI Agents SDK) — lightweight but tied to one provider
- **UI-first platforms** (Vercel AI SDK) — great for streaming but not focused on portable agent definitions
- **Rolling your own** — maximum flexibility, zero reuse, no tooling

None solve these problems simultaneously:

1. **Agent-as-config** — serialize, version, and share agent definitions
2. **Bring-your-own storage** — plug in your own persistence
3. **MCP-native tooling** — first-class Model Context Protocol support
4. **Shared context** — multi-agent systems with shared state
5. **Observable runs** — trace, inspect, and replay agent behavior

## The Solution

agntz is organized around three activities:

| Activity | Code | Studio |
|----------|------|--------|
| **Running** | `createRunner()` → `invoke()` | — |
| **Defining** | `defineAgent()` + `defineTool()` | Agent Editor + Tool Catalog |
| **Observing** | `runs` + `traces` | Run History + Trace Viewer |

Running is code-only. Defining and observing work in both code and the Studio. This keeps the production runtime minimal while providing a rich development experience.

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
import { SqliteStore } from "@agntz/store-sqlite";

// Simple persistent store
const runner = createRunner({
  store: new SqliteStore("./data.db"),
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

### CLI and SDK workflow

Start with the CLI to create and smoke-test portable YAML, then use the SDK
when your agent needs local tools, resources, or app-specific context:

```bash
npx @agntz/sdk create "Answer support questions" -o ./agents/support.yaml
npx @agntz/sdk run ./agents/support.yaml --input "Hello"
```

The same YAML can be loaded by service code through `@agntz/sdk`.

## Comparison

| Feature | agntz | LangChain | Vercel AI SDK | OpenAI Agents |
|---------|-------------|-----------|---------------|---------------|
| Agent-as-config | ✅ | ❌ | ❌ | ❌ |
| Pluggable storage | ✅ | Partial | ❌ | ❌ |
| MCP native | ✅ | Bolt-on | ❌ | ❌ |
| First-class evals | Roadmap | ❌ | ❌ | ❌ |
| Skills (mid-run instruction loading) | ✅ | ❌ | ❌ | ❌ |
| Concurrent sub-agent spawning | ✅ | Partial | ❌ | ❌ |
| Tracked Runs + replay | ✅ | ❌ | ❌ | ❌ |
| In-app distributed tracing | ✅ | Bolt-on | ❌ | ❌ |
| Hosted multi-tenant app | ✅ | ❌ | ❌ | ❌ |
| Studio UI | ✅ | ❌ | ❌ | ❌ |
| Provider agnostic | ✅ | ✅ | ✅ | ❌ |
| Lightweight | ✅ | ❌ | ✅ | ✅ |

## The pieces of the system

agntz isn't only an SDK. The hosted product is built from several packages that compose into a multi-tenant platform:

| Package | Role |
|---|---|
| `agntz` / `@agntz/core` | The SDK — agent loop, tool registry, MCP, stores. Embeddable in your own service. See [chapter 14](/guide/14-runner-architecture) |
| `@agntz/manifest` | YAML-driven agent specs and a four-kind executor. See [chapter 15](/guide/15-manifest) |
| `@agntz/store-sqlite`, `@agntz/store-postgres` | Production store adapters. See [chapter 10](/guide/10-stores) |
| `@agntz/worker` | HTTP service that owns all execution in the hosted stack. See [chapter 16](/guide/16-worker) |
| `@agntz/app` | Next.js UI with Clerk auth and multi-tenant scoping. See [chapter 17](/guide/17-app) |
| `@agntz/client` | HTTP client for calling the worker from your own apps. See [chapter 18](/guide/18-sdk-client) |

If you're embedding agents in your own backend, you only need `agntz` (plus a store). If you're building on top of the hosted product, you only need `@agntz/client`. The chapters that follow cover both paths.
