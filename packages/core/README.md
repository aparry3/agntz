# @agntz/core

[![npm version](https://img.shields.io/npm/v/@agntz/core.svg)](https://www.npmjs.com/package/@agntz/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-blue.svg)](https://www.typescriptlang.org/)

TypeScript SDK for defining, running, and evaluating AI agents. Agents are portable, JSON-serializable configurations — not code. Plug in any storage backend, any model provider, any tools.

> This is the core package of the [agntz](https://github.com/aparry3/agntz) monorepo.

## Install

```bash
npm install @agntz/core
# or
pnpm add @agntz/core
# or
yarn add @agntz/core
```

Then install at least one model provider (all optional peer dependencies):

```bash
npm install @ai-sdk/openai    # for OpenAI models
npm install @ai-sdk/anthropic  # for Anthropic models
npm install @ai-sdk/google     # for Google models
```

Set your API key:

```bash
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, etc.
```

## Quick Start

```typescript
import { createRunner, defineAgent } from "@agntz/core";

const runner = createRunner();

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter. Keep responses under 2 sentences.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
}));

const result = await runner.invoke("greeter", "Hello!");
console.log(result.output);
// → "Hey there! Welcome — great to have you here."
```

## Usage

### Defining Agents

Agents are plain data objects — JSON-serializable, portable, and versionable:

```typescript
import { defineAgent } from "@agntz/core";

const agent = defineAgent({
  id: "writer",
  name: "Writer",
  description: "Writes concise, engaging copy",
  version: "1.0.0",
  systemPrompt: "You write concise, engaging copy.",
  model: { provider: "openai", name: "gpt-5.4" },
  tags: ["content", "writing"],
});
```

### Tools

Define typed tools with Zod schemas and register them with the runner:

```typescript
import { createRunner, defineAgent, defineTool } from "@agntz/core";
import { z } from "zod";

const lookupOrder = defineTool({
  name: "lookup_order",
  description: "Look up an order by ID",
  input: z.object({ orderId: z.string() }),
  async execute(input) {
    return { status: "shipped", eta: "Tomorrow" };
  },
});

const runner = createRunner({ tools: [lookupOrder] });

runner.registerAgent(defineAgent({
  id: "support",
  name: "Support Agent",
  systemPrompt: "Help customers with their orders. Use tools to look up order info.",
  model: { provider: "openai", name: "gpt-5.4" },
  tools: [{ type: "inline", name: "lookup_order" }],
}));

const result = await runner.invoke("support", "Where's my order #12345?");
console.log(result.toolCalls);
// → [{ name: "lookup_order", input: { orderId: "12345" }, output: { status: "shipped", ... } }]
```

### Sessions (Conversational Memory)

```typescript
// First message
await runner.invoke("support", "Hi, I need help", { sessionId: "sess_abc" });

// Second message — agent remembers the conversation
await runner.invoke("support", "My order is #12345", { sessionId: "sess_abc" });
```

### Streaming

```typescript
const stream = runner.stream("writer", "Write a short story about a robot");

for await (const event of stream) {
  if (event.type === "text-delta") {
    process.stdout.write(event.text);
  } else if (event.type === "tool-call-start") {
    console.log(`\nCalling tool: ${event.toolCall.name}`);
  } else if (event.type === "done") {
    console.log(`\nTokens used: ${event.result.usage.totalTokens}`);
  }
}
```

**Stream events:**

| Event | Description |
|---|---|
| `text-delta` | Incremental text chunk from the model |
| `tool-call-start` | Tool execution is starting |
| `tool-call-end` | Tool execution completed (with result) |
| `step-complete` | One iteration of the tool loop finished |
| `done` | Final result with full `InvokeResult` |

### Agent Chains (Agent-as-Tool)

Agents can invoke other agents as tools:

```typescript
runner.registerAgent(defineAgent({
  id: "researcher",
  name: "Researcher",
  systemPrompt: "Research topics and return concise findings.",
  model: { provider: "openai", name: "gpt-5.4" },
}));

runner.registerAgent(defineAgent({
  id: "writer",
  name: "Writer",
  systemPrompt: "Write articles. Delegate research to the researcher.",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [{ type: "agent", agentId: "researcher" }],
}));

// Writer invokes researcher as a tool during execution
const result = await runner.invoke("writer", "Write about MCP");
```

### Shared Context

Context lets agents share state without tight coupling:

```typescript
// Researcher writes findings to context
await runner.invoke("researcher", "Find info about MCP", {
  contextIds: ["project-alpha"],
});

// Writer reads the same context
await runner.invoke("writer", "Write an article using the research", {
  contextIds: ["project-alpha"],
});
```

### Runtime Tool Context

Pass runtime data to tools without going through the LLM:

```typescript
const updateProfile = defineTool({
  name: "update_profile",
  description: "Update the user's profile",
  input: z.object({ field: z.string(), value: z.string() }),
  async execute(input, ctx) {
    // ctx.user comes from toolContext — injected at runtime
    await db.users.update(ctx.user.id, { [input.field]: input.value });
    return { success: true };
  },
});

await runner.invoke("chat", message, {
  toolContext: { user: { id: "u_123", name: "Aaron" } },
});
```

### Structured Output

```typescript
runner.registerAgent(defineAgent({
  id: "analyzer",
  name: "Sentiment Analyzer",
  systemPrompt: "Analyze the sentiment of input text.",
  model: { provider: "openai", name: "gpt-5.4" },
  outputSchema: {
    type: "object",
    properties: {
      sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
      confidence: { type: "number" },
    },
    required: ["sentiment", "confidence"],
  },
}));

const { output } = await runner.invoke("analyzer", "I love this!");
const parsed = JSON.parse(output);
// → { sentiment: "positive", confidence: 0.95 }
```

### MCP Integration

Use tools from any MCP-compatible server:

```typescript
const runner = createRunner({
  mcp: {
    servers: {
      github: { url: "http://localhost:3001/mcp" },
      filesystem: { command: "npx", args: ["-y", "@anthropic/mcp-fs"] },
    },
  },
});

runner.registerAgent(defineAgent({
  id: "code-reviewer",
  name: "Code Reviewer",
  systemPrompt: "Review code from GitHub PRs...",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [{ type: "mcp", server: "github", tools: ["get_file_contents"] }],
}));
```

Expose your agents as an MCP server:

```typescript
import { createMCPServer } from "@agntz/core/mcp-server";
const server = createMCPServer(runner);
```

### Evals

Built-in evaluation with assertions, LLM-as-judge, and CI integration:

```typescript
runner.registerAgent(defineAgent({
  id: "classifier",
  name: "Classifier",
  systemPrompt: "Classify support tickets...",
  model: { provider: "openai", name: "gpt-5.4" },
  eval: {
    rubric: "Must correctly classify the ticket category",
    testCases: [
      {
        name: "billing issue",
        input: "I was charged twice",
        assertions: [
          { type: "contains", value: "billing" },
          { type: "llm-rubric", value: "Response identifies this as a billing issue" },
        ],
      },
    ],
  },
}));

const results = await runner.eval("classifier");
console.log(results.summary);
// → { total: 1, passed: 1, failed: 0, score: 1.0 }
```

**Assertion types:** `contains`, `not-contains`, `regex`, `json-schema`, `llm-rubric`, `semantic-similar`, plus custom assertion plugins.

## Storage

The default store is in-memory. For persistence, use the built-in `JsonFileStore` or install a database adapter:

```typescript
import { createRunner, JsonFileStore } from "@agntz/core";

// JSON files — good for local dev
const runner = createRunner({
  store: new JsonFileStore("./data"),
});
```

**Database adapters:**

| Package | Use Case |
|---|---|
| [`@agntz/store-sqlite`](../store-sqlite) | Single-server production |
| [`@agntz/store-postgres`](../store-postgres) | Multi-server production |

You can also split stores by concern:

```typescript
const runner = createRunner({
  agentStore: myPostgresStore,
  sessionStore: myRedisStore,
  logStore: myElasticsearchStore,
});
```

### Custom Stores

Implement the store interfaces:

```typescript
interface AgentStore {
  getAgent(id: string): Promise<AgentDefinition | null>;
  listAgents(): Promise<AgentSummary[]>;
  putAgent(agent: AgentDefinition): Promise<void>;
  deleteAgent(id: string): Promise<void>;
}

interface SessionStore {
  getMessages(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(agentId?: string): Promise<SessionSummary[]>;
}

// Also: ContextStore, LogStore
// Or implement UnifiedStore for all-in-one
```

## API Reference

### `createRunner(config?: RunnerConfig): Runner`

Creates the central orchestrator. All options are optional:

```typescript
const runner = createRunner({
  store: new JsonFileStore("./data"),    // Storage backend
  tools: [myTool1, myTool2],            // Inline tools
  mcp: { servers: { ... } },            // MCP server config
  session: {                              // Session trimming
    maxMessages: 50,
    strategy: "sliding",                  // "sliding" | "summary" | "none"
  },
  context: {                              // Context injection
    maxEntries: 20,
    maxTokens: 4000,
    strategy: "latest",                   // "latest" | "summary" | "all"
  },
  defaults: {                             // Default model config
    model: { provider: "openai", name: "gpt-5.4-mini" },
    temperature: 0.7,
    maxTokens: 4096,
  },
  retry: {                                // Retry with backoff
    maxRetries: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
  },
  maxRecursionDepth: 3,                   // Agent-as-tool chain limit
  telemetry: { ... },                     // OpenTelemetry (opt-in)
});
```

### `defineAgent(config): AgentDefinition`

Creates a validated agent definition:

```typescript
const agent = defineAgent({
  id: "my-agent",
  name: "My Agent",
  systemPrompt: "...",
  model: { provider: "openai", name: "gpt-5.4" },
  // ... all fields from AgentDefinition
});
```

### `defineTool(config): ToolDefinition`

Creates a typed tool with Zod input validation:

```typescript
const tool = defineTool({
  name: "my_tool",
  description: "What this tool does",
  input: z.object({ ... }),
  async execute(input, ctx) { ... },
});
```

### Runner Methods

| Method | Description |
|---|---|
| `runner.invoke(agentId, input, options?)` | Invoke an agent and get the result |
| `runner.stream(agentId, input, options?)` | Stream an agent invocation |
| `runner.registerAgent(agent)` | Register an agent definition |
| `runner.eval(agentId, options?)` | Run evaluations for an agent |
| `runner.shutdown()` | Clean up MCP connections and flush stores |

### Key Types

| Type | Description |
|---|---|
| `AgentDefinition` | Full agent configuration object |
| `ToolDefinition` | Tool with name, description, schema, and execute function |
| `ToolReference` | Reference to a tool: `inline`, `mcp`, or `agent` |
| `InvokeOptions` | Options for `invoke()`: sessionId, contextIds, toolContext, etc. |
| `InvokeResult` | Result: output, toolCalls, usage, duration, model |
| `InvokeStream` | Async iterable of `StreamEvent` with `.result` promise |
| `RunnerConfig` | Full configuration for `createRunner()` |
| `UnifiedStore` | Combined `AgentStore & SessionStore & ContextStore & LogStore` |
| `ModelProvider` | Interface for custom model providers |

### Error Types

All errors extend `AgentRunnerError` with a `code` field:

| Error | Code | Description |
|---|---|---|
| `AgentNotFoundError` | `AGENT_NOT_FOUND` | Agent ID doesn't exist |
| `ToolNotFoundError` | `TOOL_NOT_FOUND` | Tool name not registered |
| `ToolExecutionError` | `TOOL_EXECUTION_ERROR` | Tool threw during execution |
| `ModelError` | `MODEL_ERROR` | Model provider returned an error |
| `ProviderNotFoundError` | `PROVIDER_NOT_FOUND` | No provider SDK installed |
| `InvocationCancelledError` | `INVOCATION_CANCELLED` | AbortSignal triggered |
| `MaxStepsExceededError` | `MAX_STEPS_EXCEEDED` | Tool loop hit step limit |
| `MaxRecursionDepthError` | `MAX_RECURSION_DEPTH` | Agent chain too deep |
| `RetryExhaustedError` | `RETRY_EXHAUSTED` | All retries failed |
| `ValidationError` | `VALIDATION_ERROR` | Invalid input |

## Templates

Starter agent configurations for common patterns:

```typescript
import { templates } from "@agntz/core/templates";
import { defineAgent } from "@agntz/core";

runner.registerAgent(defineAgent({
  ...templates.chatbot,
  id: "my-bot",
}));
```

**Available templates:** `chatbot`, `codeReviewer`, `summarizer`, `dataExtractor`, `creativeWriter`, `customerSupport`, `fitnessCoach`, `researcher`

## CLI

```bash
# Scaffold a new project
npx agntz init

# Invoke an agent
npx agntz invoke greeter "Hello!"

# Run evals
npx agntz eval classifier

# Interactive playground (REPL with session support)
npx agntz playground greeter
```

## Model Providers

agntz uses the [Vercel AI SDK](https://sdk.vercel.ai/) internally — calls go directly to providers with your API keys. No middleman.

```typescript
defineAgent({
  model: { provider: "openai", name: "gpt-5.4" },         // OPENAI_API_KEY
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },  // ANTHROPIC_API_KEY
  model: { provider: "google", name: "gemini-3-flash" },     // GOOGLE_GENERATIVE_AI_API_KEY
});
```

Or bring your own model provider:

```typescript
const runner = createRunner({
  modelProvider: myCustomProvider, // implements ModelProvider interface
});
```

## OpenTelemetry

Opt-in observability:

```typescript
import { trace } from "@opentelemetry/api";

const runner = createRunner({
  telemetry: {
    tracer: trace.getTracer("my-app"),
    recordIO: false,
    baseAttributes: { "service.name": "my-app" },
  },
});
```

**Span hierarchy:** `agent.invoke` → `agent.model.call` / `agent.tool.execute`

Zero overhead when telemetry is not configured.

## Related Packages

| Package | Description |
|---|---|
| [`@agntz/manifest`](../manifest) | YAML agent manifest parser + executor |
| [`@agntz/store-sqlite`](../store-sqlite) | SQLite storage adapter |
| [`@agntz/store-postgres`](../store-postgres) | PostgreSQL storage adapter (multi-tenant) |
| [`@agntz/worker`](../worker) | Hono HTTP worker for executing agents |
| [`@agntz/app`](../app) | Next.js web UI — multi-tenant, Clerk auth |

## Contributing

See the main [CONTRIBUTING.md](https://github.com/aparry3/agntz/blob/main/CONTRIBUTING.md) for guidelines.

## License

MIT © [Aaron Bidworthy](https://github.com/aparry3)
