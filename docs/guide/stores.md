# Stores

agntz uses pluggable storage interfaces. Every persistence concern — agents, sessions, context, logs — has its own interface. Use built-in stores or implement your own.

## Built-in Stores

| Store | Package | Use Case |
|-------|---------|----------|
| `MemoryStore` | `agntz` | Testing, ephemeral usage |
| `JsonFileStore` | `agntz` | Local development, prototyping |
| `SqliteStore` | `@agntz/store-sqlite` | Single-server production |

## Quick Setup

### In-Memory (Default)

```typescript
const runner = createRunner(); // Uses MemoryStore
```

### JSON Files

```typescript
import { JsonFileStore } from "agntz";

const runner = createRunner({
  store: new JsonFileStore("./data"),
});
```

Creates a directory structure:
```
./data/
├── agents/
│   └── support.json
├── sessions/
│   └── sess_abc123.json
├── context/
│   └── project-alpha.json
└── logs/
    └── 2026-03-05/
        └── inv_xyz789.json
```

### SQLite

```typescript
import { SqliteStore } from "@agntz/store-sqlite";

const runner = createRunner({
  store: new SqliteStore("./data.db"),
});
```

Uses WAL mode for performance, auto-migrates on startup.

### Split by Concern

```typescript
const runner = createRunner({
  agentStore: new JsonFileStore("./data"),
  sessionStore: new SqliteStore("./sessions.db"),
  logStore: new SqliteStore("./logs.db"),
});
```

## Store Interfaces

### AgentStore

```typescript
interface AgentStore {
  getAgent(id: string): Promise<AgentDefinition | null>;
  listAgents(): Promise<AgentSummary[]>;
  putAgent(agent: AgentDefinition): Promise<void>;
  deleteAgent(id: string): Promise<void>;
}
```

### SessionStore

```typescript
interface SessionStore {
  getMessages(sessionId: string): Promise<Message[]>;
  append(sessionId: string, messages: Message[]): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  listSessions(agentId?: string): Promise<SessionSummary[]>;
}
```

### ContextStore

```typescript
interface ContextStore {
  getContext(contextId: string): Promise<ContextEntry[]>;
  addContext(contextId: string, entry: ContextEntry): Promise<void>;
  clearContext(contextId: string): Promise<void>;
}
```

### LogStore

```typescript
interface LogStore {
  log(entry: InvocationLog): Promise<void>;
  getLogs(filter?: LogFilter): Promise<InvocationLog[]>;
  getLog(id: string): Promise<InvocationLog | null>;
}
```

## Building a Custom Store

Implement any combination of the interfaces:

```typescript
import type { AgentStore, SessionStore } from "agntz";

class MyPostgresStore implements AgentStore, SessionStore {
  constructor(private pool: Pool) {}

  async getAgent(id: string) {
    const { rows } = await this.pool.query(
      "SELECT data FROM agents WHERE id = $1", [id]
    );
    return rows[0]?.data ?? null;
  }

  // ... implement remaining methods
}
```

All store implementations should run the same contract test suite to ensure compatibility.
