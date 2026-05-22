export default `# Local tools

JavaScript / TypeScript functions registered at runtime, referenced by name in YAML. The simplest and fastest tool kind — no network, no auth — but **embedded-only**.

\`\`\`yaml [agents/calculator.yaml]
id: calculator
kind: llm
model: { provider: openai, name: gpt-5.4-mini }
instruction: |
  Use the \`add\` tool to answer math questions.

  {{userQuery}}
tools:
  - kind: local
    tools: [add]
\`\`\`

\`\`\`ts [index.ts]
const client = await agntz({
  agents: "./agents",
  tools: {
    add: async ({ a, b }: { a: number; b: number }) => a + b,
  },
});
\`\`\`

Names referenced in YAML but missing from the \`tools\` map fail at **load time**, not on first model call — misconfigurations surface immediately.

## Tool function shape

A local tool is an async function. The runner derives the tool's JSON schema from its declared TypeScript type:

\`\`\`ts
type LocalTool = (params: Record<string, any>) => Promise<unknown>;
\`\`\`

For better type inference and schema fidelity, declare your tools with explicit param types:

\`\`\`ts
const tools = {
  fetchInvoice: async ({ id }: { id: string }) => {
    return await db.invoices.findById(id);
  },
  closeTicket: async ({ ticketId, reason }: { ticketId: string; reason: string }) => {
    await api.tickets.close(ticketId, reason);
    return { ok: true };
  },
};
\`\`\`

The model sees \`fetchInvoice(id: string)\` and \`closeTicket(ticketId: string, reason: string)\` in its tool list.

## Selective exposure

By default, listing \`tools: [foo, bar]\` exposes exactly those tools. To expose all configured tools, drop the inner array:

\`\`\`yaml
tools:
  - kind: local            # all tools in the registry
\`\`\`

## Errors

If a tool throws, the model receives the error message and decides whether to retry (with different args), reply to the user with an apology, or give up. The error is captured in the \`tool.execute\` span — visible in the trace.

## Why embedded-only?

> **Note:** Local tools are an embedded-mode primitive. The hosted edition has no way to run arbitrary user code in a sandbox, so promote local tools to HTTP endpoints or MCP servers when you graduate. The YAML can switch between local and HTTP/MCP without touching the agent's instruction — only the \`tools:\` block changes.

If you want a single manifest that runs in both modes today, prefer [HTTP](/docs/tools/http) or [MCP](/docs/tools/mcp) tools from the start.
`;
