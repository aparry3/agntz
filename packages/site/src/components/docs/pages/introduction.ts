export default `# Introduction

**agntz** is an open-source agent framework where agents are declared as YAML — not code — and run unchanged in three places: embedded in your app (\`@agntz/sdk\` for TypeScript, \`agntz\` for Python), on the hosted cloud (\`agntz.co\`), or on infrastructure you control (self-host). Every run is traced. Every save is a version. Bring your own model keys.

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
2. **The client API.** \`client.agents.run(...)\` — the same resource shape in TypeScript and Python, with language-native argument names.
3. **The observability model.** Runs, spans, and traces work identically in every edition.

## Choose your starting point

| If you want to… | Use | Read |
|---|---|---|
| Run an agent on your laptop in 60 seconds | \`@agntz/sdk\` or \`agntz\` | [Quickstart](/docs/quickstart) |
| Build agents from the terminal | \`agntz\` CLI | [CLI getting started](/docs/cli-quickstart) |
| Author and run agents in a hosted UI | agntz.co | [Hosted cloud](/docs/deploy/hosted-cloud) |
| Call hosted agents from your backend | \`@agntz/client\` or \`AgntzClient\` | [Hosted client](/docs/sdk-cli/client) |
| Deploy your own hosted stack | Docker / Vercel + Railway | [Self-host](/docs/deploy/self-host-production) |

## Install

\`\`\`bash {group=intro-install select=ts}
# Embedded: run agents in-process from YAML files
pnpm add @agntz/sdk

# Hosted client: call agents on agntz.co or your own worker
pnpm add @agntz/client

# Optional persistence for embedded mode
pnpm add @agntz/store-sqlite

# CLI (run via npx or install globally)
npm i -g @agntz/sdk
\`\`\`

\`\`\`bash {group=intro-install select=python}
# Embedded local SDK + hosted client
pip install agntz

# Local model execution through LiteLLM
pip install "agntz[litellm]"
\`\`\`

Node 20+ for TypeScript. Python 3.11+ for Python. \`@agntz/client\` is universal across browser, Node, and edge runtimes; embedded SDKs read YAML from disk and run in your process.

Set the provider API key your agents will use:

\`\`\`bash
export OPENAI_API_KEY=sk-...
# or ANTHROPIC_API_KEY=sk-ant-...
# or GOOGLE_GENERATIVE_AI_API_KEY=...
# or OPENROUTER_API_KEY=sk-or-...   # 300+ models incl. open-source via one key
\`\`\`

agntz calls providers directly with your key — no proxy, no data routing. **OpenRouter** is available as a meta-provider when you want access to many models (Anthropic, Google, Meta, DeepSeek, open-source) with a single API key — use \`provider: openrouter\` and a slug like \`anthropic/claude-sonnet-4\` or \`meta-llama/llama-3.3-70b-instruct\`.

## Where to go next

- **New here?** Start with the [Quickstart](/docs/quickstart).
- **Prefer the terminal?** Jump to [CLI getting started](/docs/cli-quickstart).
- **Want the big picture?** Read [Defining agents](/docs/concepts/agents) and [The four agent kinds](/docs/concepts/agent-kinds).
- **Looking for a specific field?** The [Schema](/docs/schema/common-fields) section is the complete reference.
`;
