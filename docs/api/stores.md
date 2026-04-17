# Store Interfaces

All store interfaces are exported from `agntz`.

## AgentStore

```typescript
interface AgentStore {
  getAgent(id: string): Promise<AgentDefinition | null>;
  listAgents(): Promise<AgentSummary[]>;
  putAgent(agent: AgentDefinition): Promise<void>;
  deleteAgent(id: string): Promise<void>;
}
```

## SessionStore

```typescript
interface SessionStore {
  getMessages(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(agentId?: string): Promise<SessionSummary[]>;
}
```

## ContextStore

```typescript
interface ContextStore {
  getContext(contextId: string): Promise<ContextEntry[]>;
  addContext(contextId: string, entry: ContextEntry): Promise<void>;
  clearContext(contextId: string): Promise<void>;
}
```

## LogStore

```typescript
interface LogStore {
  log(entry: InvocationLog): Promise<void>;
  getLogs(filter?: LogFilter): Promise<InvocationLog[]>;
  getLog(id: string): Promise<InvocationLog | null>;
}
```

## Built-in Implementations

### MemoryStore

```typescript
import { MemoryStore } from "agntz";
const store = new MemoryStore();
```

Implements all four interfaces. Data is lost on process exit.

### JsonFileStore

```typescript
import { JsonFileStore } from "agntz";
const store = new JsonFileStore("./data");
```

Implements all four interfaces. Stores data as JSON files.

### SqliteStore

```typescript
import { SqliteStore } from "@agntz/store-sqlite";
const store = new SqliteStore("./data.db");
```

Implements all four interfaces. Uses WAL mode, auto-migrates.
