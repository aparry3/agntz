# Types

All types are exported from `agntz`.

## Core Types

```typescript
// Agent definition
interface AgentDefinition { ... }

// Model configuration
interface ModelConfig {
  provider: string;
  name: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  options?: Record<string, unknown>;
}

// Tool reference (how agents reference tools)
type ToolReference =
  | { type: "inline"; name: string }
  | { type: "mcp"; server: string; tools?: string[] }
  | { type: "agent"; agentId: string };

// Message
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCallRecord[];
  toolCallId?: string;
  timestamp: string;
}

// Context entry
interface ContextEntry {
  contextId: string;
  agentId: string;
  invocationId: string;
  content: string;
  createdAt: string;
}

// Invocation log
interface InvocationLog {
  id: string;
  agentId: string;
  sessionId?: string;
  input: string;
  output: string;
  toolCalls: ToolCallRecord[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  duration: number;
  model: string;
  error?: string;
  timestamp: string;
}
```

## Error Types

```typescript
class AgentNotFoundError extends Error {
  agentId: string;
}

class ToolNotFoundError extends Error {
  toolName: string;
}

class ToolExecutionError extends Error {
  toolName: string;
  cause: unknown;
}

class MaxRecursionError extends Error {
  depth: number;
  maxDepth: number;
}

class ModelError extends Error {
  provider: string;
  model: string;
}
```
