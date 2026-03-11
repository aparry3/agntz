# @agent-runner/store-postgres

[![npm version](https://img.shields.io/npm/v/@agent-runner/store-postgres.svg)](https://www.npmjs.com/package/@agent-runner/store-postgres)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

PostgreSQL storage adapter for [agent-runner](https://github.com/aparry3/agent-runner). Production-ready persistent storage for multi-server deployments with automatic migrations, JSONB storage, connection pooling, and configurable table prefixes.

## Install

```bash
npm install @agent-runner/store-postgres @agent-runner/core
# or
pnpm add @agent-runner/store-postgres @agent-runner/core
# or
yarn add @agent-runner/store-postgres @agent-runner/core
```

## Quick Start

```typescript
import { createRunner, defineAgent } from "@agent-runner/core";
import { PostgresStore } from "@agent-runner/store-postgres";

const runner = createRunner({
  store: new PostgresStore("postgresql://user:pass@localhost:5432/mydb"),
});

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter.",
  model: { provider: "openai", name: "gpt-4o-mini" },
}));

const result = await runner.invoke("greeter", "Hello!");
console.log(result.output);
```

## Usage

### Connection String

The simplest way — pass a PostgreSQL connection string:

```typescript
const store = new PostgresStore("postgresql://user:pass@localhost:5432/mydb");
```

### Existing Connection Pool

Share a `pg.Pool` across your application to manage connections centrally:

```typescript
import pg from "pg";
import { PostgresStore } from "@agent-runner/store-postgres";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

const store = new PostgresStore({ connection: pool });

// The store won't close this pool on shutdown (you own it)
```

### Pool Configuration

Pass a `pg.PoolConfig` object for fine-grained control:

```typescript
const store = new PostgresStore({
  connection: {
    host: "localhost",
    port: 5432,
    database: "mydb",
    user: "myuser",
    password: "mypassword",
    max: 10,
    ssl: { rejectUnauthorized: false },
  },
});
```

### Table Prefix

Avoid naming conflicts by customizing the table prefix (default: `ar_`):

```typescript
const store = new PostgresStore({
  connection: "postgresql://localhost:5432/mydb",
  tablePrefix: "myapp_",
});
// Tables: myapp_agents, myapp_sessions, myapp_messages, etc.
```

### Skip Auto-Migration

If you manage migrations separately:

```typescript
const store = new PostgresStore({
  connection: "postgresql://localhost:5432/mydb",
  skipMigration: true,
});
```

## API Reference

### `PostgresStore`

Implements `UnifiedStore` from `@agent-runner/core` — provides `AgentStore`, `SessionStore`, `ContextStore`, and `LogStore` in a single class.

#### Constructor

```typescript
new PostgresStore(connectionString: string)
new PostgresStore(options: PostgresStoreOptions)
```

#### `PostgresStoreOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `connection` | `string \| pg.Pool \| pg.PoolConfig` | — | **Required.** Connection string, pool instance, or pool config |
| `tablePrefix` | `string` | `"ar_"` | Prefix for all table names |
| `skipMigration` | `boolean` | `false` | Skip automatic schema migration |

#### Store Methods

**AgentStore:**

| Method | Description |
|---|---|
| `getAgent(id)` | Get an agent definition by ID |
| `listAgents()` | List all agents (id, name, description) |
| `putAgent(agent)` | Create or update an agent |
| `deleteAgent(id)` | Delete an agent |

**SessionStore:**

| Method | Description |
|---|---|
| `getMessages(sessionId)` | Get all messages in a session |
| `append(sessionId, messages)` | Append messages (creates session if needed) |
| `deleteSession(sessionId)` | Delete a session and its messages |
| `listSessions(agentId?)` | List sessions, optionally filtered by agent |

**ContextStore:**

| Method | Description |
|---|---|
| `getContext(contextId)` | Get all entries for a context bucket |
| `addContext(contextId, entry)` | Add an entry to a context bucket |
| `clearContext(contextId)` | Clear all entries in a context bucket |

**LogStore:**

| Method | Description |
|---|---|
| `log(entry)` | Write an invocation log |
| `getLogs(filter?)` | Query logs with optional filters |
| `getLog(id)` | Get a single log by ID |

**Lifecycle:**

| Method | Description |
|---|---|
| `close()` | Close the connection pool (only if the store created it) |
| `pgPool` | Access the underlying `pg.Pool` for advanced queries |

## Schema

The store creates the following tables automatically (prefixed with `ar_` by default):

| Table | Description |
|---|---|
| `ar_agents` | Agent definitions stored as JSONB |
| `ar_sessions` | Session metadata with timestamps |
| `ar_messages` | Conversation messages with JSONB tool calls |
| `ar_context_entries` | Shared context entries between agents |
| `ar_invocation_logs` | Full invocation logs with token usage |
| `ar_schema_version` | Migration version tracking |

**Indexes** are created on session_id, agent_id, and timestamp columns for efficient querying.

## Performance Notes

- **JSONB storage** for agent definitions and tool calls — supports efficient querying and indexing
- **Connection pooling** via `pg.Pool` — configure `max` connections based on your workload
- **Transaction safety** — session message appends and deletes use transactions with rollback
- **Async migrations** — schema migrations run automatically on first use, not on construction
- **Shared pools** — pass an existing `pg.Pool` to avoid creating duplicate connections

### Recommended Production Settings

```typescript
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 5000, // Fail fast on connection issues
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: true }
    : false,
});

const store = new PostgresStore({ connection: pool });
```

## PostgreSQL Setup

If you need to create a database:

```sql
CREATE DATABASE mydb;
CREATE USER myuser WITH PASSWORD 'mypassword';
GRANT ALL PRIVILEGES ON DATABASE mydb TO myuser;
```

Or with Docker:

```bash
docker run -d \
  --name agent-runner-pg \
  -e POSTGRES_DB=mydb \
  -e POSTGRES_USER=myuser \
  -e POSTGRES_PASSWORD=mypassword \
  -p 5432:5432 \
  postgres:16
```

## Graceful Shutdown

```typescript
process.on("SIGTERM", async () => {
  await runner.shutdown();  // Cleans up MCP connections
  await store.close();      // Closes the pg pool (if store-owned)
  process.exit(0);
});
```

## Examples

### Split Stores

Use PostgreSQL for agents and logs, but a different store for sessions:

```typescript
import { createRunner, MemoryStore } from "@agent-runner/core";
import { PostgresStore } from "@agent-runner/store-postgres";

const pgStore = new PostgresStore(process.env.DATABASE_URL!);

const runner = createRunner({
  agentStore: pgStore,
  logStore: pgStore,
  sessionStore: new MemoryStore(), // ephemeral sessions
  contextStore: pgStore,
});
```

### With Studio

```typescript
import { createRunner } from "@agent-runner/core";
import { PostgresStore } from "@agent-runner/store-postgres";
import { createStudio } from "@agent-runner/studio";

const runner = createRunner({
  store: new PostgresStore(process.env.DATABASE_URL!),
});

// Studio reads/writes through the same Postgres store
const studio = await createStudio(runner, { port: 4000 });
```

## Related Packages

| Package | Description |
|---|---|
| [`@agent-runner/core`](../core) | Core SDK — createRunner, agents, tools, stores |
| [`@agent-runner/store-sqlite`](../store-sqlite) | SQLite adapter for single-server deployments |
| [`@agent-runner/studio`](../studio) | Development UI |

## Contributing

See the main [CONTRIBUTING.md](https://github.com/aparry3/agent-runner/blob/main/CONTRIBUTING.md) for guidelines.

## License

MIT © [Aaron Bidworthy](https://github.com/aparry3)
