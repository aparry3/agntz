export default `# Introduction

**agntz** is an open-source agent framework where agents are declared as YAML — not code — and run unchanged in three places: embedded in your app (\`@agntz/sdk\`), on the hosted cloud (\`agntz.co\`), or on infrastructure you control (self-host). Every run is traced. Every save is a version. Bring your own model keys.

These docs are optimized for both humans and LLMs. Every page is also available as raw markdown — see the **Copy** button at the top of each page, or fetch [/llms.txt](/llms.txt) for the full corpus.

## What you can build

- **Single-call agents** — an LLM with an instruction, optional tools, optional structured output.
- **Pipelines** — sequential and parallel agents that compose other agents into multi-step workflows with loops and conditionals.
- **Tool agents** — deterministic function calls with no LLM in the loop.
- **Long-running conversations** — sessions persist message history across calls.
- **Streaming UIs** — full event stream (tokens, tool calls, replies) over Server-Sent Events.
- **Multi-tenant products** — every record is user-scoped on the hosted edition.

Three things stay the same as you scale from your laptop to production:

1. **The YAML schema.** One \`manifest.yaml\` runs in embedded mode, hosted mode, and self-hosted mode.
2. **The client API.** \`client.agents.run({ agentId, input })\` — same call against \`@agntz/sdk\` and \`@agntz/client\`.
3. **The observability model.** Runs, spans, and traces work identically in every edition.

## Choose your starting point

| If you want to… | Use | Read |
|---|---|---|
| Run an agent on your laptop in 60 seconds | \`@agntz/sdk\` | [Quickstart](/docs/quickstart) |
| Build agents from the terminal | \`agntz\` CLI | [CLI quickstart](/docs/cli-quickstart) |
| Author and run agents in a hosted UI | agntz.co | [Hosted cloud](/docs/deploy/hosted-cloud) |
| Call hosted agents from your backend | \`@agntz/client\` | [@agntz/client](/docs/sdk-cli/client) |
| Deploy your own hosted stack | Docker / Vercel + Railway | [Self-host](/docs/deploy/self-host-production) |

## Install

\`\`\`bash
# Embedded: run agents in-process from YAML files
pnpm add @agntz/sdk

# Hosted client: call agents on agntz.co or your own worker
pnpm add @agntz/client

# Optional persistence for embedded mode
pnpm add @agntz/store-sqlite

# CLI (run via npx or install globally)
npm i -g @agntz/sdk
\`\`\`

Node 20+ in all cases. \`@agntz/client\` is universal (browsers + Node + edge runtimes); \`@agntz/sdk\` is Node-only because it reads YAML from disk.

Set the provider API key your agents will use:

\`\`\`bash
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY=sk-ant-...
# or GOOGLE_GENERATIVE_AI_API_KEY=...
\`\`\`

agntz calls providers directly with your key — no proxy, no data routing.

## Where to go next

- **New here?** Start with the [Quickstart](/docs/quickstart).
- **Prefer the terminal?** Jump to the [CLI quickstart](/docs/cli-quickstart).
- **Want the big picture?** Read [Defining agents](/docs/concepts/agents) and [The four agent kinds](/docs/concepts/agent-kinds).
- **Looking for a specific field?** The [Schema](/docs/schema/common-fields) section is the complete reference.
`;
