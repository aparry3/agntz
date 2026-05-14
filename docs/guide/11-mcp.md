# MCP Integration

agntz has first-class support for the [Model Context Protocol](https://modelcontextprotocol.io/) (MCP). You can connect to MCP servers as tool sources and expose your agents as MCP tools.

## Connecting to MCP Servers

agntz supports **HTTP/SSE transport only** — stdio is intentionally unsupported (see `packages/core/src/mcp/server.ts`). MCP servers must be reachable over HTTP/HTTPS. If a server you want to use only speaks stdio, run it behind a thin HTTP shim.

```typescript
const runner = createRunner({
  mcp: {
    servers: {
      github: {
        url: "http://localhost:3001/mcp",
        headers: { Authorization: "Bearer ..." },
      },
    },
  },
});
```

`MCPServerConfig` is `{ url: string; headers?: Record<string, string> }` (`packages/core/src/types.ts:402-407`).

## Using MCP Tools

Once connected, MCP tools appear in the Tool Registry and can be assigned to agents:

```typescript
defineAgent({
  id: "code-reviewer",
  systemPrompt: "Review code from GitHub PRs...",
  model: { provider: "anthropic", name: "claude-sonnet-4-6" },
  tools: [
    // All tools from the server
    { type: "mcp", server: "github" },
    // Or specific tools
    { type: "mcp", server: "github", tools: ["get_file_contents"] },
  ],
});
```

## Browsing MCP Tools

```typescript
// List all tools (including MCP)
const tools = runner.tools.list();
// → [{ name: "get_file_contents", source: "mcp:github", ... }]
```

In the Studio, the MCP Servers page shows connection status and available tools for each server.

## Exposing Agents as MCP Tools

Make your agents callable by other MCP-compatible systems:

```typescript
import { createMCPServer } from "agntz/mcp-server";

const server = createMCPServer(runner);
// Each agent becomes a callable tool:
// - invoke_support(input, sessionId?)
// - invoke_writer(input, sessionId?)
```

## Lazy Initialization

MCP connections are established lazily on first invocation, not at startup. This means:
- Starting the runner is instant
- Unused MCP servers don't consume resources
- Connection errors surface at invocation time

## Shutdown

Call `runner.shutdown()` to cleanly close all MCP connections:

```typescript
process.on("SIGTERM", async () => {
  await runner.shutdown();
  process.exit(0);
});
```
