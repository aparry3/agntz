export default `# Local tools

Local tools are functions registered at runtime and referenced by name in YAML. They are the simplest and fastest tool kind — no network and no auth — but they only work in embedded mode because hosted workers cannot execute arbitrary user code.

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

\`\`\`ts [index.ts] {group=local-tool-basic}
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

\`\`\`python [main.py] {group=local-tool-basic}
from pydantic import BaseModel, Field
from agntz import LiteLLMModelProvider, agntz, tool


class AddInput(BaseModel):
    a: float = Field(description="First operand")
    b: float = Field(description="Second operand")


def add(args: AddInput) -> float:
    return args.a + args.b


client = agntz(
    agents="./agents",
    tools=[
        tool(
            name="add",
            description="Add two numbers and return the sum",
            input_schema=AddInput,
            execute=add,
        )
    ],
    model_provider=LiteLLMModelProvider(),
)
\`\`\`

Names referenced in YAML but missing from the local tool registry fail before a successful run. This keeps misconfigurations out of production traffic.

## Tool shape

Each tool is self-describing. The model sees the \`name\`, \`description\`, and JSON Schema derived from your validation schema.

| TypeScript field | Python field | Purpose |
| --- | --- | --- |
| \`name\` | \`name\` | Identifier referenced from YAML \`tools: [name]\` |
| \`description\` | \`description\` | What the tool does; read by the model |
| \`input\` | \`input_schema\` | Zod or Pydantic schema used for validation and JSON Schema |
| \`execute\` | \`execute\` | Function called with parsed args |

\`\`\`ts {group=local-tool-shape}
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
];
\`\`\`

\`\`\`python {group=local-tool-shape}
from pydantic import BaseModel, Field
from agntz import tool


class FetchInvoiceInput(BaseModel):
    id: str = Field(description="Invoice id, e.g. inv_abc123")


def fetch_invoice(args: FetchInvoiceInput):
    return db.invoices.find_by_id(args.id)


tools = [
    tool(
        name="fetchInvoice",
        description="Look up an invoice record by its id",
        input_schema=FetchInvoiceInput,
        execute=fetch_invoice,
    )
]
\`\`\`

TypeScript uses Zod because \`@agntz/sdk\` already depends on it. Python uses Pydantic because it is the native validation and schema path for Python applications.

## Selective exposure

By default, listing \`tools: [foo, bar]\` exposes exactly those tools. To expose all configured tools, drop the inner array:

\`\`\`yaml
tools:
  - kind: local            # all tools in the registry
\`\`\`

## Errors

If a tool throws, the model receives the error message and can decide whether to retry with different args, reply to the user, or give up. The error is captured in the tool span and appears in traces.

Validation errors are returned to the model the same way, so a model that calls \`add({ a: "two", b: 3 })\` sees a structured complaint and can correct itself on the next step.

## Why embedded-only?

> **Note:** Local tools are an embedded-mode primitive. The hosted edition has no way to run arbitrary user code in a sandbox, so promote local tools to HTTP endpoints or MCP servers when you graduate. The YAML can switch between local and HTTP/MCP without touching the agent's instruction — only the \`tools:\` block changes.

If you want a single manifest that runs in both local and hosted modes, prefer [HTTP](/docs/tools/http) or [MCP](/docs/tools/mcp) tools from the start.
`;
