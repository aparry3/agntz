export default `# MCP tools

[Model Context Protocol](https://modelcontextprotocol.io) servers expose discoverable tool catalogs. Reference a server URL and the runner connects, lists the available tools, and exposes them to the model.

\`\`\`yaml
tools:
  - kind: mcp
    server: https://search-api.example.com/mcp
    tools:
      - fetch_url                       # use as-is
      - tool: search                    # wrapped tool
        name: search_for_user           # what the LLM sees
        description: "Search records by query"
        params:
          api_key: "{{env.SEARCH_KEY}}"   # pinned, hidden from the LLM
\`\`\`

## Selective vs full exposure

Drop the inner \`tools:\` array to expose every tool the server advertises:

\`\`\`yaml
tools:
  - kind: mcp
    server: https://search-api.example.com/mcp     # all tools
\`\`\`

List specific tools to expose only those:

\`\`\`yaml
tools:
  - kind: mcp
    server: https://search-api.example.com/mcp
    tools: [search, fetch_url]
\`\`\`

## Wrapping a tool

Use the long form (\`tool:\`) to rename a tool, override its description, or pin parameters:

\`\`\`yaml
tools:
  - kind: mcp
    server: https://mcp.example.com/sse
    tools:
      - tool: search
        name: search_current_user        # optional rename
        description: "Search the current user's records"
        params:
          user_id: "{{userId}}"           # state-templated, hidden from the LLM
\`\`\`

This is how you ground tools in per-invocation context (user id, tenant id, scopes) **without** trusting the model to pass them correctly. The pinned params are injected at execution and hidden from the LLM's schema.

## Auth

MCP servers handle auth at the protocol level. The runner forwards \`headers:\` (templated like HTTP tools) on the underlying connection:

\`\`\`yaml
tools:
  - kind: mcp
    server: https://api.example.com/mcp
    headers:
      Authorization: "Bearer {{secrets.MCP_TOKEN}}"
\`\`\`

For SSE-based MCP servers, headers are sent on the long-lived connect; for HTTP-streaming servers they're sent on each request.

## Connection lifecycle

In **embedded** mode, the runner connects lazily on first tool call and reuses the connection for the process lifetime. No connection store required.

In **hosted** mode, connections are pooled per workspace and recycled on idle. \`{{env.X}}\` is opt-in per server (because multi-tenant workers don't share an environment with your code) — prefer \`{{secrets.X}}\` for credentials.

## Failures

If the MCP server is down at runtime, the tool call fails — captured in the trace as a \`tool.execute\` span with status \`error\`. The model sees a sanitized error message and can decide whether to retry or give up.

If the server is down at **load time**, embedded mode logs a warning and continues; the failure surfaces on first call. This is intentional — agents that depend on remote services shouldn't refuse to boot just because a downstream is briefly unavailable.
`;
