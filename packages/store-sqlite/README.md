# @agntz/store-sqlite

[![npm version](https://img.shields.io/npm/v/@agntz/store-sqlite.svg)](https://www.npmjs.com/package/@agntz/store-sqlite)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

SQLite storage adapter for [agntz](https://github.com/aparry3/agntz). Zero-config persistent storage for single-server deployments with WAL mode, automatic migrations, and full-text search on logs.

Built on [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for synchronous, high-performance access.

## Install

```bash
npm install @agntz/store-sqlite @agntz/core
# or
pnpm add @agntz/store-sqlite @agntz/core
# or
yarn add @agntz/store-sqlite @agntz/core
```

## Quick Start

```typescript
import { createRunner, defineAgent } from "@agntz/core";
import { SqliteStore } from "@agntz/store-sqlite";

const runner = createRunner({
  store: new SqliteStore("./data.db"),
});

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter.",
  model: { provider: "openai", name: "gpt-5.4-mini" },
}));

const result = await runner.invoke("greeter", "Hello!");
console.log(result.output);
```

That's it. The database file is created automatically with all tables and indexes.

## Usage

### File-Based Storage

The most common setup — a single file that persists everything:

```typescript
const store = new SqliteStore("./data.db");
```

This creates (or opens) `./data.db` with WAL mode enabled for concurrent read performance.

### In-Memory Storage

For testing or ephemeral workloads:

```typescript
const store = new SqliteStore(":memory:");
```

Same API, same schema — data lives only in memory.

### Full Options

```typescript
const store = new SqliteStore({
  path: "./data.db",
  wal: true,       // WAL mode for better concurrent reads (default: true)
  verbose: false,  // Log all SQL queries to console (default: false)
});
```

## API Reference

### `SqliteStore`

Implements `UnifiedStore` from `@agntz/core` — provides `AgentStore`, `SessionStore`, `ContextStore`, and `LogStore` in a single class.

#### Constructor

```typescript
new SqliteStore(path: string)
new SqliteStore(options: SqliteStoreOptions)
```

#### `SqliteStoreOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | — | **Required.** Path to SQLite file, or `":memory:"` |
| `wal` | `boolean` | `true` | Enable WAL journal mode |
| `verbose` | `boolean` | `false` | Log all SQL queries to console |

#### Store Methods

**AgentStore:**

| Method | Description |
|---|---|
| `getAgent(id)` | Get an agent definition by ID |
| `listAgents()` | List all agents (id, name, description) |
| `putAgent(agent)` | Create or update an agent (upsert) |
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
| `getLogs(filter?)` | Query logs with optional filters (agentId, sessionId, since, limit, offset) |
| `getLog(id)` | Get a single log by ID |

**Lifecycle:**

| Method | Description |
|---|---|
| `close()` | Close the database connection |
| `database` | Access the underlying `better-sqlite3` Database instance |

## Schema

The store creates the following tables automatically:

| Table | Description |
|---|---|
| `agents` | Agent definitions stored as JSON text |
| `sessions` | Session metadata with timestamps |
| `messages` | Conversation messages with JSON tool calls |
| `context_entries` | Shared context entries between agents |
| `invocation_logs` | Full invocation logs with token usage |
| `schema_version` | Migration version tracking |

**Indexes** on `messages(session_id)`, `context_entries(context_id)`, `invocation_logs(agent_id)`, `invocation_logs(session_id)`, and `invocation_logs(timestamp)`.

## Performance Notes

- **WAL mode** enabled by default — dramatically improves concurrent read performance
- **Synchronous = NORMAL** — good balance of durability and speed
- **Busy timeout = 5s** — handles brief write contention gracefully
- **Foreign keys** enabled — cascading deletes keep data consistent
- **Transactions** — session appends and deletes are wrapped in transactions for atomicity
- **Synchronous API** — better-sqlite3 is synchronous under the hood, so no connection pool overhead

### When to Use SQLite vs PostgreSQL

| | SQLite | PostgreSQL |
|---|---|---|
| **Deployment** | Single server | Multi-server |
| **Setup** | Zero config — just a file path | Requires a running database |
| **Concurrent writes** | One writer at a time (WAL helps reads) | Full concurrent writes |
| **Best for** | Dev, prototyping, single-instance production | Scaled production, multiple app instances |
| **Package** | `@agntz/store-sqlite` | [`@agntz/store-postgres`](../store-postgres) |

## Examples

### Local Development

```typescript
import { createRunner, defineAgent, JsonFileStore } from "@agntz/core";
import { SqliteStore } from "@agntz/store-sqlite";

// Upgrade from JsonFileStore to SQLite — same API
const runner = createRunner({
  store: new SqliteStore("./dev.db"),
});
```

### Testing with In-Memory Store

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createRunner } from "@agntz/core";
import { SqliteStore } from "@agntz/store-sqlite";

describe("my agent", () => {
  let runner;

  beforeEach(() => {
    // Fresh database for every test — fast and isolated
    runner = createRunner({
      store: new SqliteStore(":memory:"),
    });
  });

  it("persists sessions", async () => {
    // ...
  });
});
```

### Advanced: Direct Database Access

```typescript
const store = new SqliteStore("./data.db");

// Run custom queries against the underlying database
const db = store.database;
const count = db.prepare("SELECT COUNT(*) as n FROM invocation_logs").get();
console.log(`Total invocations: ${count.n}`);
```

### Graceful Shutdown

```typescript
process.on("SIGTERM", async () => {
  await runner.shutdown();
  store.close();
  process.exit(0);
});
```

## Related Packages

| Package | Description |
|---|---|
| [`@agntz/core`](../core) | Core SDK — createRunner, agents, tools, stores |
| [`@agntz/store-postgres`](../store-postgres) | PostgreSQL adapter for multi-server deployments |

## Contributing

See the main [CONTRIBUTING.md](https://github.com/aparry3/agntz/blob/main/CONTRIBUTING.md) for guidelines.

## License

MIT © [Aaron Bidworthy](https://github.com/aparry3)
