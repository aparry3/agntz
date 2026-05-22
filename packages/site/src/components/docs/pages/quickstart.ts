export default `# Quickstart

The fastest path: write a YAML file, point \`@agntz/sdk\` at the directory, call it. No server, no signup, no infrastructure.

## Install

\`\`\`bash
pnpm add @agntz/sdk
export ANTHROPIC_API_KEY=sk-ant-...     # or OPENAI_API_KEY, OPENROUTER_API_KEY, etc.
\`\`\`

See [Models & providers](/docs/models) for the full list of supported providers.

## 1. Create an agent

\`\`\`yaml [agents/support.yaml]
id: support
kind: llm
model:
  provider: anthropic
  name: claude-sonnet-4-6
instruction: |
  You are a friendly customer support agent. Answer concisely.

  {{userQuery}}
\`\`\`

The agent's \`id\` is how you'll address it from code. \`kind: llm\` means a single model call. With no \`inputSchema\`, the agent takes a plain string, accessible in templates as \`{{userQuery}}\`.

## 2. Run it

\`\`\`ts [index.ts]
import { agntz } from "@agntz/sdk";

const client = await agntz({ agents: "./agents" });

const result = await client.agents.run({
  agentId: "support",
  input: "How do I reset my password?",
});

console.log(result.output);
\`\`\`

\`\`\`bash
node --experimental-strip-types index.ts
\`\`\`

That's it. The runner parses every \`.yaml\` file under \`./agents\`, validates them against the schema, registers them with an in-process runtime, and exposes the same \`client.agents.run / stream\`, \`client.runs.list\`, \`client.traces.get\` surface as the hosted SDK.

## 3. Stream tokens

\`\`\`ts
for await (const event of client.agents.stream({
  agentId: "support",
  input: "Walk me through password reset",
})) {
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "complete") console.log("\\n— done");
}
\`\`\`

See [Stream events](/docs/sdk-cli/sdk#stream-events) for the full event union.

## 4. Use the same code against the hosted cloud later

When you outgrow embedded mode — durable run history, multi-user isolation, agent management UI — change one line:

\`\`\`diff
- import { agntz } from "@agntz/sdk";
+ import { AgntzClient } from "@agntz/client";

- const client = await agntz({ agents: "./agents" });
+ const client = new AgntzClient({ apiKey: process.env.AGNTZ_API_KEY! });
\`\`\`

The \`agents.run\`, \`agents.stream\`, \`runs.list\`, and \`traces.get\` calls work identically. YAML manifests move to the hosted registry; in-process \`tools\` become MCP servers or HTTP endpoints.

## Next steps

- **Add structured I/O.** Declare an [\`inputSchema\` and \`outputSchema\`](/docs/schema/input-state-output) to type-check the agent's contract.
- **Add tools.** Wire up [HTTP](/docs/tools/http), [MCP](/docs/tools/mcp), or [local](/docs/tools/local) tools.
- **Chain agents.** Compose multi-step workflows with [sequential and parallel pipelines](/docs/concepts/agent-kinds).
- **Persist sessions.** Install \`@agntz/store-sqlite\` for [durable conversation history](/docs/concepts/sessions).
`;
