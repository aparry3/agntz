# @agent-runner/studio

[![npm version](https://img.shields.io/npm/v/@agent-runner/studio.svg)](https://www.npmjs.com/package/@agent-runner/studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)

Visual development UI for [agent-runner](https://github.com/aparry3/agent-runner). Define, test, and debug agents with a browser-based studio — agent editor, interactive playground, tool catalog, MCP server management, eval dashboard, session browser, and invocation logs.

## Install

```bash
npm install @agent-runner/studio @agent-runner/core
# or
pnpm add @agent-runner/studio @agent-runner/core
# or
yarn add @agent-runner/studio @agent-runner/core
```

## Quick Start

The fastest way to launch Studio:

```bash
npx agent-runner studio
```

Or programmatically:

```typescript
import { createRunner, defineAgent } from "@agent-runner/core";
import { createStudio } from "@agent-runner/studio";

const runner = createRunner();

runner.registerAgent(defineAgent({
  id: "greeter",
  name: "Greeter",
  systemPrompt: "You are a friendly greeter.",
  model: { provider: "openai", name: "gpt-4o-mini" },
}));

const studio = await createStudio(runner, { port: 4000 });
console.log(`Studio running at ${studio.url}`);
// → Studio running at http://localhost:4000
```

## Studio Pages

| Page | Description |
|---|---|
| **Agent Editor** | Create and edit agent definitions — system prompts, model config, tool references, eval cases |
| **Playground** | Interactive chat with any registered agent, with session support |
| **Tool Catalog** | Browse all registered tools (inline + MCP) with schemas and test execution |
| **MCP Servers** | View connected MCP servers, their status, and available tools |
| **Evals Dashboard** | Run evaluations and view results with pass/fail breakdowns |
| **Context Browser** | Inspect shared context buckets and their entries |
| **Sessions** | Browse conversation sessions and their message history |
| **Logs** | View invocation logs with token usage, duration, and tool calls |

## Usage

### Standalone Server

Launch Studio as its own HTTP server:

```typescript
import { createRunner } from "@agent-runner/core";
import { createStudio } from "@agent-runner/studio";

const runner = createRunner({ /* your config */ });

const studio = await createStudio(runner, {
  port: 4000,          // default: 4000
  hostname: "0.0.0.0", // default: "localhost"
  onReady: (url) => console.log(`Studio → ${url}`),
});

// Later: shut down cleanly
await studio.close();
```

### Middleware (Embed in Your App)

Mount Studio's API routes inside an existing Hono app:

```typescript
import { Hono } from "hono";
import { studioMiddleware } from "@agent-runner/studio/middleware";

const app = new Hono();
const runner = createRunner({ /* your config */ });

// Mount Studio under /studio
app.route("/studio", studioMiddleware(runner));

// Your other routes
app.get("/api/hello", (c) => c.json({ hello: "world" }));
```

The middleware provides all Studio API endpoints — perfect for adding a dev dashboard to an existing service.

## API Reference

### `createStudio(runner, options?)`

Creates and starts a standalone Studio server.

```typescript
const studio = await createStudio(runner, options);
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `runner` | `Runner` | An `@agent-runner/core` Runner instance |
| `options` | `StudioOptions` | Optional configuration |

**StudioOptions:**

| Option | Type | Default | Description |
|---|---|---|---|
| `port` | `number` | `4000` | Port to listen on |
| `hostname` | `string` | `"localhost"` | Hostname to bind to |
| `onReady` | `(url: string) => void` | — | Callback when server starts |

**Returns:**

| Property | Type | Description |
|---|---|---|
| `url` | `string` | The full URL where Studio is running |
| `app` | `Hono` | The underlying Hono app instance |
| `close()` | `() => Promise<void>` | Gracefully shut down the server |

### `studioMiddleware(runner)`

Creates a Hono app with Studio API routes, suitable for mounting as middleware.

```typescript
import { studioMiddleware } from "@agent-runner/studio/middleware";

const studioApp = studioMiddleware(runner);
app.route("/studio", studioApp);
```

## API Endpoints

Studio exposes a REST API that powers the UI. You can also call these endpoints directly:

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check — returns `{ status: "ok" }` |

### Agents

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agents` | List all agents |
| `GET` | `/api/agents/:id` | Get agent definition |
| `PUT` | `/api/agents/:id` | Create or update an agent |
| `DELETE` | `/api/agents/:id` | Delete an agent |
| `POST` | `/api/agents/:id/invoke` | Invoke an agent (playground) |

**Invoke body:**

```json
{
  "input": "Hello!",
  "sessionId": "optional-session-id",
  "contextIds": ["optional-context-ids"],
  "extraContext": "optional extra context string",
  "toolContext": {}
}
```

### Tools

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tools` | List all registered tools |
| `GET` | `/api/tools/:name` | Get tool details and schema |
| `POST` | `/api/tools/:name/test` | Test-execute a tool with input |

### MCP Servers

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mcp/servers` | List all MCP servers and their status |
| `GET` | `/api/mcp/servers/:name` | Get status for a specific server |
| `GET` | `/api/mcp/servers/:name/tools` | List tools from a specific MCP server |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sessions` | List sessions (optional `?agentId=` filter) |
| `GET` | `/api/sessions/:id` | Get session messages |
| `DELETE` | `/api/sessions/:id` | Delete a session |

### Context

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/context/:contextId` | Get context entries with size/count |
| `POST` | `/api/context/:contextId` | Add a context entry |
| `DELETE` | `/api/context/:contextId` | Clear a context bucket |

### Evals

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/evals/:agentId/run` | Run evals for an agent |

### Logs

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/logs` | Query logs (`?agentId=`, `?sessionId=`, `?since=`, `?limit=`, `?offset=`) |
| `GET` | `/api/logs/:id` | Get a specific log entry |

## Examples

### Full Development Setup

```typescript
import { createRunner, defineAgent, defineTool, JsonFileStore } from "@agent-runner/core";
import { SqliteStore } from "@agent-runner/store-sqlite";
import { createStudio } from "@agent-runner/studio";
import { z } from "zod";

const runner = createRunner({
  store: new SqliteStore("./dev.db"),
  tools: [
    defineTool({
      name: "get_weather",
      description: "Get current weather for a city",
      input: z.object({ city: z.string() }),
      async execute({ city }) {
        return { temp: 72, condition: "sunny", city };
      },
    }),
  ],
  mcp: {
    servers: {
      filesystem: { command: "npx", args: ["-y", "@anthropic/mcp-fs"] },
    },
  },
});

runner.registerAgent(defineAgent({
  id: "assistant",
  name: "Assistant",
  systemPrompt: "You're a helpful assistant with access to weather data.",
  model: { provider: "openai", name: "gpt-4o" },
  tools: [
    { type: "inline", name: "get_weather" },
    { type: "mcp", server: "filesystem" },
  ],
  eval: {
    testCases: [
      {
        name: "weather query",
        input: "What's the weather in NYC?",
        assertions: [{ type: "contains", value: "sunny" }],
      },
    ],
  },
}));

const studio = await createStudio(runner, {
  port: 4000,
  onReady: (url) => console.log(`\n  🎨 Studio → ${url}\n`),
});
```

### Production: Embed in Express/Hono App

```typescript
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createRunner } from "@agent-runner/core";
import { PostgresStore } from "@agent-runner/store-postgres";
import { studioMiddleware } from "@agent-runner/studio/middleware";

const runner = createRunner({
  store: new PostgresStore(process.env.DATABASE_URL!),
});

const app = new Hono();

// Your API routes
app.get("/api/v1/chat", async (c) => {
  const result = await runner.invoke("chatbot", c.req.query("message")!);
  return c.json(result);
});

// Mount Studio (dev only)
if (process.env.NODE_ENV !== "production") {
  app.route("/studio", studioMiddleware(runner));
}

serve({ fetch: app.fetch, port: 3000 });
```

## Built With

- [Hono](https://hono.dev/) — Lightweight web framework for the API server
- [React](https://react.dev/) + [React Router](https://reactrouter.com/) — Studio UI
- [Vite](https://vite.dev/) — UI build tooling

## Related Packages

| Package | Description |
|---|---|
| [`@agent-runner/core`](../core) | Core SDK — createRunner, agents, tools, stores |
| [`@agent-runner/store-sqlite`](../store-sqlite) | SQLite storage adapter |
| [`@agent-runner/store-postgres`](../store-postgres) | PostgreSQL storage adapter |

## Contributing

See the main [CONTRIBUTING.md](https://github.com/aparry3/agent-runner/blob/main/CONTRIBUTING.md) for guidelines.

## License

MIT © [Aaron Bidworthy](https://github.com/aparry3)
