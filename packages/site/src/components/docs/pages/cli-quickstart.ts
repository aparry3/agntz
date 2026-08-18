export default `# CLI getting started

Use the \`agntz\` CLI when you want to create a YAML agent, edit it in your repo, and run it locally from the terminal. This is the fastest path for a human or coding agent to add an agent to an existing codebase.

The first workflow is local. Hosted cloud comes later.

## Install

\`\`\`bash
# Run on demand
npx @agntz/sdk --help

# Or install the agntz executable globally
npm i -g @agntz/sdk
agntz --help
\`\`\`

The CLI is published by the \`@agntz/sdk\` package. The executable name is \`agntz\`.

## 1. Create an agent YAML

\`\`\`bash
mkdir -p agents
agntz create "Answer customer support questions in a concise, practical tone." -o ./agents/support.yaml
\`\`\`

\`create\` calls the hosted agent-builder and writes a portable YAML manifest. It does not require login.

After generation, inspect the file:

\`\`\`bash
sed -n '1,220p' ./agents/support.yaml
\`\`\`

The important fields are:

| Field | Why it matters |
|---|---|
| \`id\` | The name used by the CLI, SDK, and hosted client. |
| \`kind\` | The agent shape: \`llm\`, \`transcription\`, \`image\`, \`tool\`, \`sequential\`, or \`parallel\`. |
| \`model\` | The provider and model used for local LLM calls. |
| \`instruction\` / \`prompt\` | The behavior and input template. |
| \`inputSchema\` / \`outputSchema\` | Canonical JSON Schema for application contracts and structured output. |
| \`tools\` / \`resources\` | Runtime capabilities the agent expects. |
| \`retention\` | Hosted defaults for run, trace, session, and artifact persistence. |

\`transcription\` and \`image\` manifests use the hosted/self-hosted worker
operation adapters; the local CLI currently executes \`llm\`, \`tool\`,
\`sequential\`, and \`parallel\`.

## 2. Edit or iterate

You can edit YAML directly, or ask the hosted editor to revise the existing manifest:

\`\`\`bash
agntz edit ./agents/support.yaml \\
  "Ask one clarifying question when the request is ambiguous." \\
  --write
\`\`\`

Use direct YAML edits for exact IDs, model changes, prompts, schemas, and tool wiring. Use \`agntz edit --select <agentId>\` to target one uniquely matching block in a composed manifest. The older \`create --current-manifest\` revision flow also remains supported.

## 3. Run locally

Set the provider key required by the manifest's \`model.provider\`, then run the YAML file:

\`\`\`bash
export OPENAI_API_KEY=sk-...
agntz run ./agents/support.yaml --input "How do I reset my password?"
\`\`\`

The CLI treats a target as local when it is a file path, starts with \`./\`, contains a slash, or ends in \`.yaml\` / \`.yml\`.

Useful local run variants:

\`\`\`bash
# Stream events
agntz run ./agents/support.yaml --input "Walk me through password reset" --stream

# Pipe stdin
printf "Summarize this support ticket" | agntz run ./agents/support.yaml

# Keep a conversation session
agntz run ./agents/support.yaml --session local-user-42 --input "My email is wrong"
agntz run ./agents/support.yaml --session local-user-42 --input "What did I just tell you?"

# Run a directory only when it contains one manifest
agntz run ./agents --input "Hello"
\`\`\`

Input precedence is \`--input\`, then trailing positional text, then piped stdin, then an empty string.

## 4. Call the agent from your service

Use the CLI to create and smoke-test the YAML. Use \`@agntz/sdk\` from service code when the agent needs local tools, resource providers, durable stores, or app-specific runtime context.

\`\`\`bash
pnpm add @agntz/sdk
\`\`\`

\`\`\`ts [index.ts]
import { agntz, tool, z } from "@agntz/sdk";

const client = await agntz({
  agents: "./agents",
  tools: [
    tool({
      name: "lookup_order",
      description: "Look up an order by ID",
      input: z.object({ orderId: z.string() }),
      execute: async ({ orderId }) => {
        return { orderId, status: "shipped" };
      },
    }),
  ],
});

const result = await client.agents.run({
  agentId: "support",
  input: { userQuery: "Where is order 123?" },
  sessionId: "user-42",
});

console.log(result.output);
\`\`\`

The terminal CLI can load local YAML and run HTTP/MCP/LLM-only agents. It cannot register arbitrary in-repo local tool handlers by itself; those handlers live in \`agntz({ tools: [...] })\` in your application code.

## 5. Optional hosted publishing and invocation

Log in with an API key from the hosted or self-hosted dashboard, preview the import, then publish the local manifests. Publishing an existing agent id creates a new hosted version by default.

\`\`\`bash
agntz login --key ar_live_...
agntz publish agents --agents-dir ./agents --dry-run
agntz publish agents --agents-dir ./agents --yes
agntz run support --remote --input "Hello from the hosted runtime"
\`\`\`

Use \`--skip-existing\` to leave existing hosted ids unchanged or \`--fail-existing\` to treat them as errors. \`--yes\` skips the confirmation prompt and is required for non-interactive publishing unless the command is a dry run.

The publish command uploads manifests, not arbitrary in-process TypeScript or Python tool handlers. Before running remotely, expose those dependencies as hosted MCP/HTTP tools or signed callback endpoints and configure the worker's provider credentials.

A bare target like \`support\` is treated as hosted. Force hosted mode with \`--remote\`; force local mode with \`--local\`.

Hosted service code uses \`@agntz/client\`:

\`\`\`ts
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://api.agntz.co",
});

const result = await client.agents.run({
  agentId: "support",
  input: "Hello",
});
\`\`\`

## LLM operator recipe

If you are asking Claude Code, Codex, or another coding agent to use agntz in a repo, give it this sequence:

\`\`\`text
Use agntz locally first.
1. Check whether this repo already has an agents/ directory.
2. Install or invoke the CLI from @agntz/sdk.
3. Create ./agents/<agent-id>.yaml with agntz create; revise it with agntz edit or direct YAML changes.
4. Inspect the YAML and make direct edits for ids, prompts, schemas, models, tools, and resources.
5. Validate the manifest set with agntz validate ./agents.
6. Run the YAML with agntz run ./agents/<agent-id>.yaml --input "...".
7. If the agent needs local code tools or resource providers, add @agntz/sdk service code and pass tools/resources to agntz(...).
8. When hosted execution is needed, log in, dry-run \`agntz publish agents --agents-dir ./agents\`, publish with \`--yes\`, and run the hosted id with \`--remote\`.
\`\`\`

## Current CLI boundary

The current CLI supports \`create\`, \`edit\`, \`validate\`, \`run\`, \`publish\`, \`login\`, \`logout\`, \`whoami\`, \`eval\`, \`runs\`, and \`traces\`.

It does not currently provide project scaffolding, an interactive terminal playground, or a Studio launcher. Use \`agntz validate --json\` for CI and editor automation, and see the [CLI reference](/docs/sdk-cli/cli) for the current command set.

## Next steps

- **[CLI reference](/docs/sdk-cli/cli)** — every command and flag.
- **[Embedded SDK](/docs/sdk-cli/sdk)** — run agents from TypeScript or Python service code.
- **[Defining agents](/docs/concepts/agents)** — understand and edit the generated YAML.
- **[Local tools](/docs/tools/local)** — wire in-process tool handlers from your service.
`;
