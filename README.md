# agent-runner

A TypeScript SDK for defining, running, and evaluating AI agents. Agents are portable, JSON-serializable configurations — not code. Plug in any storage backend, any model provider, any tools.

```typescript
import { createRunner, defineAgent } from "agent-runner";

const runner = createRunner();

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter. Keep responses under 2 sentences.",
  model: { provider: "openai", name: "gpt-4o-mini" },
}));

const result = await runner.invoke("greeter", "Hello!");
console.log(result.output);
// → "Hey there! Welcome — great to have you here."
```

## Why agent-runner?

| Problem | agent-runner's answer |
|---|---|
| Agents are code, not portable config | Agent definitions are JSON-serializable data |
| Locked into one storage backend | Pluggable stores (memory, JSON files, SQLite, Postgres) |
| MCP bolted on as an afterthought | MCP is a first-class tool source |
| No built-in testing | Eval system with assertions, LLM-as-judge, CI integration |
| No visual tooling | Built-in Studio UI (`npx agent-runner studio`) |
| Heavy framework overhead | Minimal library — import what you need |

## Install

```bash
npm install agent-runner
```

Set your API key:

```bash
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, etc.
```

## Quick Start

### 1. Basic Agent

```typescript
import { createRunner, defineAgent } from "agent-runner";

const runner = createRunner();

runner.registerAgent(defineAgent({
  id: "writer",
  name: "Writer",
  systemPrompt: "You write concise, engaging copy.",
  model: { provider: "openai", name: "gpt-4o" },
}));

const { output } = await runner.invoke("writer", "Write a tagline for a coffee shop");
```

### 2. With Tools

```typescript
import { createRunner, defineAgent, defineTool } from "agent-runner";
import { z } from "zod";

const lookupOrder = defineTool({
  name: "lookup_order",
  description: "Look up an order by ID",
  input: z.object({
    orderId: z.string(),
  }),
  async execute(input) {
    return { status: "shipped", eta: "Tomorrow" };
  },
});

const runner = createRunner({ tools: [lookupOrder] });

runner.registerAgent(defineAgent({
  id: "support",
  name: "Support Agent",
  systemPrompt: "You help customers with their orders. Use tools to look up order info.",
  model: { provider: "openai", name: "gpt-4o" },
  tools: [{ type: "inline", name: "lookup_order" }],
}));

const result = await runner.invoke("support", "Where's my order #12345?");
console.log(result.output);
// → "Your order #12345 has shipped and should arrive tomorrow!"
console.log(result.toolCalls);
// → [{ name: "lookup_order", input: { orderId: "12345" }, output: { status: "shipped", eta: "Tomorrow" }, ... }]
```

### 3. Sessions (Conversational Memory)

```typescript
// First message
await runner.invoke("support", "Hi, I need help", { sessionId: "sess_abc" });

// Second message — agent remembers the conversation
await runner.invoke("support", "My order is #12345", { sessionId: "sess_abc" });
```

### 4. Streaming

```typescript
const stream = runner.stream("writer", "Write a short story about a robot");

for await (const event of stream) {
  if (event.type === "text-delta") {
    process.stdout.write(event.text);
  } else if (event.type === "tool-call-start") {
    console.log(`\nCalling tool: ${event.toolCall.name}`);
  } else if (event.type === "done") {
    console.log(`\nDone! Tokens used: ${event.result.usage.totalTokens}`);
  }
}

// Or get the final result directly
const result = await stream.result;
```

### 5. Agent Chains (Agent-as-Tool)

```typescript
runner.registerAgent(defineAgent({
  id: "researcher",
  name: "Researcher",
  systemPrompt: "Research topics and return concise findings.",
  model: { provider: "openai", name: "gpt-4o" },
}));

runner.registerAgent(defineAgent({
  id: "writer",
  name: "Writer",
  systemPrompt: "Write articles. Delegate research to the researcher.",
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
  tools: [{ type: "agent", agentId: "researcher" }],
}));

// Writer invokes researcher as a tool during execution
const result = await runner.invoke("writer", "Write about MCP");
```

### 6. Shared Context

Context lets agents share state without tight coupling:

```typescript
runner.registerAgent(defineAgent({
  id: "researcher",
  name: "Researcher",
  systemPrompt: "Research topics thoroughly.",
  model: { provider: "openai", name: "gpt-4o" },
  contextWrite: true, // Output auto-writes to context
}));

// Researcher writes findings to context
await runner.invoke("researcher", "Find info about MCP", {
  contextIds: ["project-alpha"],
});

// Writer reads the same context
await runner.invoke("writer", "Write an article using the research", {
  contextIds: ["project-alpha"],
});
```

### 7. Runtime Tool Context

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
  toolContext: {
    user: { id: "u_123", name: "Aaron" },
  },
});
```

### 8. Structured Output

```typescript
runner.registerAgent(defineAgent({
  id: "analyzer",
  name: "Sentiment Analyzer",
  systemPrompt: "Analyze the sentiment of input text.",
  model: { provider: "openai", name: "gpt-4o" },
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

## Storage

The default store is in-memory (great for testing). For persistence:

```typescript
import { createRunner, JsonFileStore } from "agent-runner";

// JSON files — good for local dev
const runner = createRunner({
  store: new JsonFileStore("./data"),
});

// Or split stores by concern
const runner = createRunner({
  agentStore: myPostgresStore,
  sessionStore: myRedisStore,
  logStore: myElasticsearchStore,
});
```

### Store Layout (JSON)

```
./data/
├── agents/       # Agent definitions
├── sessions/     # Conversation histories
├── context/      # Shared context buckets
└── logs/         # Invocation logs
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

## Model Providers

agent-runner uses the `ai` package internally — a client library that calls providers directly with your API keys. No middleman, no data routing.

```typescript
// Set provider in agent definition
defineAgent({
  model: { provider: "openai", name: "gpt-4o" },      // needs OPENAI_API_KEY
  // or
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" }, // needs ANTHROPIC_API_KEY
  // or
  model: { provider: "google", name: "gemini-2.0-flash" },    // needs GOOGLE_GENERATIVE_AI_API_KEY
});

// Or bring your own model provider entirely
const runner = createRunner({
  modelProvider: myCustomProvider, // implements ModelProvider interface
});
```

## Error Handling

All errors extend `AgentRunnerError` with a `code` field:

```typescript
import {
  AgentRunnerError,
  AgentNotFoundError,
  ToolExecutionError,
  InvocationCancelledError,
  MaxStepsExceededError,
} from "agent-runner";

try {
  await runner.invoke("nonexistent", "hi");
} catch (err) {
  if (err instanceof AgentNotFoundError) {
    console.log(err.agentId); // "nonexistent"
    console.log(err.code);    // "AGENT_NOT_FOUND"
  }
}
```

## Stream Events

The `stream()` method returns an async iterable of typed events:

| Event | Description |
|---|---|
| `text-delta` | Incremental text chunk from the model |
| `tool-call-start` | Tool execution is starting |
| `tool-call-end` | Tool execution completed (with result) |
| `step-complete` | One iteration of the tool loop finished |
| `done` | Final result with full InvokeResult |

## Configuration

```typescript
const runner = createRunner({
  // Storage
  store: new JsonFileStore("./data"),

  // Inline tools
  tools: [myTool1, myTool2],

  // Session config
  session: {
    maxMessages: 50,       // Sliding window size
    strategy: "sliding",   // "sliding" | "summary" | "none"
  },

  // Context config
  context: {
    maxEntries: 20,        // Max entries per context ID
    maxTokens: 4000,       // Token budget for injection
    strategy: "latest",    // "latest" | "summary" | "all"
  },

  // Default model (when agent doesn't specify)
  defaults: {
    model: { provider: "openai", name: "gpt-4o-mini" },
    temperature: 0.7,
    maxTokens: 4096,
  },
});
```

## MCP Integration

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
  model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
  tools: [
    { type: "mcp", server: "github", tools: ["get_file_contents"] },
  ],
}));
```

Expose your agents as an MCP server:

```typescript
import { createMCPServer } from "agent-runner/mcp-server";
const server = createMCPServer(runner);
// Each agent becomes a callable MCP tool
```

## Evals

Built-in evaluation with assertions, LLM-as-judge, and CI integration:

```typescript
runner.registerAgent(defineAgent({
  id: "classifier",
  name: "Classifier",
  systemPrompt: "Classify support tickets...",
  model: { provider: "openai", name: "gpt-4o" },
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

// Run evals programmatically
const results = await runner.eval("classifier");
console.log(results.summary);
// → { total: 1, passed: 1, failed: 0, score: 1.0 }
```

Assertion types: `contains`, `not-contains`, `regex`, `json-schema`, `llm-rubric`, `semantic-similar`, plus custom assertion plugins.

## Session Strategies

Control how conversation history is managed:

```typescript
const runner = createRunner({
  session: {
    maxMessages: 50,
    strategy: "sliding",   // Keep last N messages (default)
    // strategy: "summary", // LLM-summarizes old messages, keeps recent
    // strategy: "none",    // Keep all messages (no trimming)
  },
});
```

The `summary` strategy uses the agent's model to compress older messages while keeping recent context intact — great for long-running conversations.

## Retry & Error Recovery

Configurable retry with exponential backoff for transient failures:

```typescript
const result = await runner.invoke("writer", "Hello", {
  retry: {
    maxRetries: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2,
  },
});
```

## Graceful Shutdown

Clean up MCP connections and flush stores:

```typescript
// Close all connections
await runner.shutdown();

// Or handle process signals
process.on("SIGTERM", async () => {
  await runner.shutdown();
  process.exit(0);
});
```

## Studio

Visual development UI for defining, testing, and debugging agents:

```bash
npx agent-runner studio
```

Or embed in your app:

```typescript
import { createStudio } from "@agent-runner/studio";
const studio = createStudio(runner);
studio.listen(4000);

// Or as middleware
import { studioMiddleware } from "@agent-runner/studio/middleware";
app.use("/studio", studioMiddleware(runner));
```

**Studio pages:** Agent Editor, Tool Catalog, MCP Servers, Playground, Evals Dashboard, Context Browser, Sessions, Logs.

## SQLite Store

For production single-server deployments:

```bash
npm install @agent-runner/store-sqlite
```

```typescript
import { SqliteStore } from "@agent-runner/store-sqlite";

const runner = createRunner({
  store: new SqliteStore("./data.db"),
});
```

WAL mode enabled by default, automatic migrations, full-text search on logs.

## CLI

```bash
# Scaffold a new project
npx agent-runner init

# Invoke an agent
npx agent-runner invoke greeter "Hello!"

# Run evals
npx agent-runner eval classifier

# Launch the Studio
npx agent-runner studio
```

## Packages

| Package | Description |
|---|---|
| `agent-runner` | Core SDK — createRunner, invoke, agents, tools, stores |
| `@agent-runner/studio` | Development UI — agent editor, playground, evals dashboard |
| `@agent-runner/store-sqlite` | SQLite store adapter for production use |

## License

MIT
