# createRunner()

Creates the central orchestrator that owns stores, tool registry, MCP connections, and provides the public API.

## Signature

```typescript
function createRunner(options?: RunnerOptions): Runner
```

## Options

```typescript
interface RunnerOptions {
  // Storage (unified or split)
  store?: UnifiedStore;
  agentStore?: AgentStore;
  sessionStore?: SessionStore;
  contextStore?: ContextStore;
  logStore?: LogStore;

  // Inline tools
  tools?: ToolDefinition[];

  // MCP servers
  mcp?: {
    servers: Record<string, MCPServerConfig>;
  };

  // Session config
  session?: {
    maxMessages?: number;       // Default: 50
    maxTokens?: number;         // Default: 8000
    strategy?: "sliding" | "summary" | "none"; // Default: "sliding"
  };

  // Context config
  context?: {
    maxEntries?: number;        // Default: 20
    maxTokens?: number;         // Default: 4000
    strategy?: "latest" | "summary" | "all"; // Default: "latest"
  };

  // Custom model provider (bypasses `ai` package)
  modelProvider?: ModelProvider;

  // Default model settings
  defaults?: {
    model?: { provider: string; name: string };
    temperature?: number;
    maxTokens?: number;
    maxRecursionDepth?: number; // Default: 3
  };

  // Retry config
  retry?: RetryConfig;

  // Custom eval assertion plugins
  evalPlugins?: Record<string, AssertionPlugin>;
}
```

## Runner Interface

```typescript
interface Runner {
  // Invoke an agent
  invoke(agentId: string, input: string, options?: InvokeOptions): Promise<InvokeResult>;

  // Register agents and tools
  registerAgent(agent: AgentDefinition): void;
  registerTool(tool: ToolDefinition): void;

  // Tool registry
  tools: {
    list(): ToolInfo[];
    get(name: string): ToolInfo | undefined;
    execute(name: string, input: unknown): Promise<unknown>;
  };

  // Context management
  context: {
    get(contextId: string): Promise<ContextEntry[]>;
    add(contextId: string, entry: Omit<ContextEntry, 'contextId'>): Promise<void>;
    clear(contextId: string): Promise<void>;
  };

  // Run evals
  eval(agentId: string, options?: EvalOptions): Promise<EvalResult>;

  // Graceful shutdown
  shutdown(): Promise<void>;
}
```

## InvokeOptions

```typescript
interface InvokeOptions {
  sessionId?: string;           // Conversational continuity
  contextIds?: string[];        // Context buckets to inject
  extraContext?: string;        // Ad-hoc context string
  toolContext?: Record<string, any>;  // Runtime data for tools
  stream?: boolean;             // Streaming mode
  signal?: AbortSignal;         // Cancellation
}
```

## InvokeResult

```typescript
interface InvokeResult {
  output: string;               // Final text response
  invocationId: string;         // Unique ID
  toolCalls: ToolCallRecord[];  // All tool calls made
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  duration: number;             // Milliseconds
  model: string;                // Model used
}
```

## Example

```typescript
import { createRunner, defineAgent, JsonFileStore } from "agntz";

const runner = createRunner({
  store: new JsonFileStore("./data"),
  defaults: {
    model: { provider: "openai", name: "gpt-5.4-mini" },
  },
});

runner.registerAgent(defineAgent({
  id: "helper",
  name: "Helper",
  systemPrompt: "You are helpful.",
  model: { provider: "openai", name: "gpt-5.4" },
}));

const result = await runner.invoke("helper", "What is 2+2?");
```
