# Stores

agntz uses pluggable storage interfaces. Every persistence concern — agents, sessions, context, logs, runs, traces, skills, API keys — has its own interface. They're combined into a `UnifiedStore` (`packages/core/src/types.ts:836-846`). Use built-in stores or implement your own.

## Built-in Stores

| Store | Package | Use Case |
|-------|---------|----------|
| `MemoryStore` | `agntz` | Testing, ephemeral usage |
| `SqliteStore` | `@agntz/store-sqlite` | Single-server production |
| `PostgresStore` | `@agntz/store-postgres` | Multi-server / hosted production |

## Quick Setup

### In-Memory (Default)

```typescript
const runner = createRunner(); // Uses MemoryStore
```

### SQLite

```typescript
import { SqliteStore } from "@agntz/store-sqlite";

const runner = createRunner({
  store: new SqliteStore("./data.db"),
});
```

Uses WAL mode for performance, auto-migrates on startup.

### PostgreSQL

```typescript
import { PostgresStore } from "@agntz/store-postgres";

const runner = createRunner({
  store: new PostgresStore("postgresql://user:pass@localhost:5432/mydb"),
});

// Or bring your own pg.Pool for connection sharing:
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const runner = createRunner({
  store: new PostgresStore({ connection: pool }),
});
```

`PostgresStore` is the recommended production store for multi-server deployments — it implements every interface in `UnifiedStore` (agents, sessions, context, logs, runs, traces, skills, providers, connections, API keys) with row-level `user_id` scoping. JSONB columns hold agent definitions and span attributes; cursor-based pagination on `listRuns` and `listTraces`. This is what the hosted worker runs against.

### Split by Concern

```typescript
const runner = createRunner({
  agentStore: myPostgresStore,
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

## Migrations

Both `SqliteStore` and `PostgresStore` initialize their schema on first connection and migrate forward automatically — there is no separate `migrate` CLI step. Three guarantees:

- **Advisory locks.** On Postgres, the migration path acquires a global advisory lock before checking `schema_version`, so concurrent worker boots can't race the migration. On SQLite, the file lock serves the same role.
- **Idempotent.** Re-running migrations on an already-migrated database is a no-op.
- **Self-healing.** The Postgres migration path detects and repairs known stale states (e.g. orphaned `schema_version` rows from a prior crash).

The migration logic lives directly in each store implementation: `packages/store-postgres/src/postgres-store.ts` and `packages/store-sqlite/src/sqlite-store.ts`. New schema versions are added by appending to a versioned migration list inside the store class.

> Note: there is currently no shared migration abstraction across stores — the patterns are similar but the SQL is hand-maintained per backend. A unified migration layer is on the roadmap.
