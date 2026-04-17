# Changelog

All notable changes to agntz will be documented in this file.

## [0.1.0] — 2026-03-09

### 🎉 Initial Release

First complete release of agntz — a TypeScript SDK for defining, running, and evaluating AI agents with first-class MCP support and pluggable storage.

### Core SDK (`@agntz/core`)

- **`createRunner()`** — Central orchestrator with pluggable stores, tools, MCP, and model providers
- **`defineAgent()`** — JSON-serializable agent definitions (system prompt + model + tools + schema)
- **`defineTool()`** — Type-safe tool definitions with Zod schemas and execution context
- **`invoke()`** — Full agent execution loop (model → tool calls → repeat until done)
- **`stream()`** — Streaming invocation with typed events (text-delta, tool-call-start/end, done)
- **`eval()`** — Built-in evaluation with 6 assertion types + custom plugins
- **Sessions** — Conversational continuity with sliding window, summary, and no-trim strategies
- **Context** — Named shared-state buckets for multi-agent collaboration
- **Agent-as-tool** — Agents can invoke other agents as tools (configurable recursion depth)
- **Runtime tool context** — Pass application data to tools via `toolContext`
- **Structured output** — JSON Schema constraints on agent output
- **MCP client** — Connect to MCP servers (stdio + HTTP/SSE), auto-discover tools
- **MCP server export** — Expose agents as callable MCP tools via `createMCPServer()`
- **Retry with backoff** — Configurable retry for transient model failures
- **Graceful shutdown** — Clean up MCP connections and flush stores
- **Typed errors** — AgentNotFoundError, ToolNotFoundError, ToolExecutionError, etc.
- **Model provider layer** — BYOK via `ai` package (40+ providers) or custom `ModelProvider`
- **Stores** — `MemoryStore` (testing), `JsonFileStore` (local dev)

### Studio (`@agntz/studio`)

- **8 pages** — Agent Editor, Tool Catalog, MCP Servers, Playground, Evals Dashboard, Context Browser, Sessions, Logs
- **Hono API server** — Full REST API auto-generated from runner stores
- **React + Vite SPA** — Dark theme, 260KB bundle (80KB gzipped)
- **Embeddable** — `createStudio(runner)` standalone or `studioMiddleware(runner)` for Express/Hono/Next.js

### SQLite Store (`@agntz/store-sqlite`)

- **Production-ready** — WAL mode, automatic migrations, proper indexing
- **Full interface** — AgentStore, SessionStore, ContextStore, LogStore

### Testing

- 222 tests across 17 test files — all passing
- Performance benchmarks (1M+ ops/s for in-memory invocations)
