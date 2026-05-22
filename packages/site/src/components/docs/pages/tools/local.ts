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
import { agntz, tool, z } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tools: [
    tool({
      name: "add",
      description: "Add two numbers and return the sum",
      input: z.object({
        a: z.number().describe("First operand"),
        b: z.number().describe("Second operand"),
      }),
      execute: async ({ a, b }) => a + b,
    }),
  ],
});
\`\`\`

Names referenced in YAML but missing from the \`tools\` array fail at **load time**, not on first model call — misconfigurations surface immediately.

## Tool shape

Each tool is a self-describing object. The model sees the \`name\`, the \`description\`, and a JSON schema derived from the Zod \`input\` schema — so field-level \`.describe()\` calls flow through to the model's tool list and guide its argument choices.

| Field | Type | Purpose |
| --- | --- | --- |
| \`name\` | string | Identifier referenced from YAML \`tools: [name]\` |
| \`description\` | string | What the tool does — read by the model when deciding to call |
| \`input\` | Zod schema | Validates args at call time *and* produces the JSON schema the model sees |
| \`execute\` | async function | Receives the parsed args (typed from the schema) and a \`ToolContext\` |

The \`tool()\` helper is an identity function — it exists purely to give \`execute\` typed access to the inferred argument shape. You can also pass raw \`ToolDefinition\` objects from \`@agntz/core\` if you prefer.

\`\`\`ts
import { tool, z } from "@agntz/sdk";

const tools = [
  tool({
    name: "fetchInvoice",
    description: "Look up an invoice record by its id",
    input: z.object({
      id: z.string().describe("Invoice id, e.g. inv_abc123"),
    }),
    execute: async ({ id }) => {
      return await db.invoices.findById(id);
    },
  }),
  tool({
    name: "closeTicket",
    description: "Close a support ticket with a reason",
    input: z.object({
      ticketId: z.string().describe("Ticket id"),
      reason: z.string().describe("Short, user-facing reason for closing"),
    }),
    execute: async ({ ticketId, reason }) => {
      await api.tickets.close(ticketId, reason);
      return { ok: true };
    },
  }),
];
\`\`\`

\`z\` is re-exported from \`@agntz/sdk\` so you don't need a separate \`zod\` install — the SDK already depends on it.

## Selective exposure

By default, listing \`tools: [foo, bar]\` exposes exactly those tools. To expose all configured tools, drop the inner array:

\`\`\`yaml
tools:
  - kind: local            # all tools in the registry
\`\`\`

## Errors

If a tool throws, the model receives the error message and decides whether to retry (with different args), reply to the user with an apology, or give up. The error is captured in the \`tool.execute\` span — visible in the trace.

Zod validation errors are returned to the model the same way — so a model that calls \`add({ a: "two", b: 3 })\` sees a structured complaint and can correct itself on the next step.

## Why embedded-only?

> **Note:** Local tools are an embedded-mode primitive. The hosted edition has no way to run arbitrary user code in a sandbox, so promote local tools to HTTP endpoints or MCP servers when you graduate. The YAML can switch between local and HTTP/MCP without touching the agent's instruction — only the \`tools:\` block changes.

If you want a single manifest that runs in both modes today, prefer [HTTP](/docs/tools/http) or [MCP](/docs/tools/mcp) tools from the start.
`;
