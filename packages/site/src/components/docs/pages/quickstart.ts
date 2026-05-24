export default `# Quickstart

The fastest path: write a YAML file, point an Agntz SDK at the directory, call it. No server, no signup, no infrastructure. The YAML is shared between TypeScript and Python; the client code follows each language's conventions.

## Install

\`\`\`bash {group=quickstart-install select=ts}
pnpm add @agntz/sdk
export ANTHROPIC_API_KEY=sk-ant-...     # or OPENAI_API_KEY, OPENROUTER_API_KEY, etc.
\`\`\`

\`\`\`bash {group=quickstart-install select=python}
pip install "agntz[litellm]"
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

\`\`\`ts [index.ts] {group=quickstart-run}
import { agntz } from "@agntz/sdk";

const client = await agntz({ agents: "./agents" });

const result = await client.agents.run({
  agentId: "support",
  input: "How do I reset my password?",
});

console.log(result.output);
\`\`\`

\`\`\`python [main.py] {group=quickstart-run}
from agntz import LiteLLMModelProvider, agntz

client = agntz(
    agents="./agents",
    model_provider=LiteLLMModelProvider(),
)

result = client.agents.run(
    agent_id="support",
    input="How do I reset my password?",
)

print(result.output)
\`\`\`

\`\`\`bash {group=quickstart-command select=ts}
node --experimental-strip-types index.ts
\`\`\`

\`\`\`bash {group=quickstart-command select=python}
python main.py
\`\`\`

That's it. The SDK parses every \`.yaml\` file under \`./agents\`, validates it against the schema, registers it with the runtime, and exposes the same \`client.agents.run\`, \`client.runs.list\`, and \`client.traces.get\` surface as the hosted client.

## 3. Stream or inspect

\`\`\`ts {group=quickstart-stream}
for await (const event of client.agents.stream({
  agentId: "support",
  input: "Walk me through password reset",
})) {
  if (event.type === "text-delta") process.stdout.write(event.text);
  if (event.type === "complete") console.log("\\n— done");
}
\`\`\`

\`\`\`python {group=quickstart-stream}
for event in client.agents.stream(
    agent_id="support",
    input="Walk me through password reset",
):
    if event.type == "complete":
        print(event.output)
\`\`\`

TypeScript local runs expose token deltas for LLM streaming today. Python local runs expose start and complete events in this first slice; the hosted Python client streams the worker's SSE events.

## 4. Use the same call against the hosted cloud later

When you outgrow embedded mode — durable run history, multi-user isolation, agent management UI — switch constructors and keep the same resource shape:

\`\`\`diff {group=quickstart-hosted}
- import { agntz } from "@agntz/sdk";
+ import { AgntzClient } from "@agntz/client";

- const client = await agntz({ agents: "./agents" });
+ const client = new AgntzClient({
+   apiKey: process.env.AGNTZ_API_KEY!,
+   baseUrl: "https://api.agntz.co",
+ });
\`\`\`

\`\`\`python {group=quickstart-hosted}
import os
from agntz import AgntzClient

client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
)
\`\`\`

The \`agents.run\`, \`runs.list\`, and \`traces.get\` calls work across local and hosted clients. YAML manifests move to the hosted registry; in-process local tools become MCP servers or HTTP endpoints.

## Next steps

- **Add structured I/O.** Declare an [\`inputSchema\` and \`outputSchema\`](/docs/schema/input-state-output) to type-check the agent's contract.
- **Add tools.** Wire up [HTTP](/docs/tools/http), [MCP](/docs/tools/mcp), or [local](/docs/tools/local) tools.
- **Chain agents.** Compose multi-step workflows with [sequential and parallel pipelines](/docs/concepts/agent-kinds).
- **Persist sessions.** Use SQLite for [durable conversation history](/docs/concepts/sessions).
`;
