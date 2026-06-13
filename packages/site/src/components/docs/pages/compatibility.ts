export default `# Compatibility matrix

What runs where, today. Embedded means in-process SDK execution: \`@agntz/sdk\` for TypeScript and \`agntz\` for Python. Hosted means \`agntz.co\` and self-hosted workers.

| Feature | TS embedded | Python embedded | Hosted worker |
|---|:---:|:---:|:---:|
| LLM agents | ✓ | ✓ | ✓ |
| Sequential / parallel / tool kinds | ✓ | ✓ | ✓ |
| Local tools | ✓ (JS/TS) | ✓ (Python) | (use MCP / HTTP instead) |
| HTTP tools | ✓ | ✓ | ✓ |
| HTTP tools — OAuth2 / token exchange | ✓ | partial | ✓ |
| MCP tools (raw URL + headers) | ✓ | ✓ (HTTP JSON-RPC) | ✓ |
| Agent-as-tool | ✓ | ✓ | ✓ |
| Runtime \`context\` namespace grants | ✓ | ✓ | ✓ |
| \`resources:\` manifest declarations | ✓ | ✓ | ✓ if provider wired |
| Generic resource provider runtime | ✓ | ✓ | self-host configurable |
| memrez memory resource provider | ✓ | ✓ | self-host configurable |
| memrez SQLite / Postgres memory stores | ✓ | ✓ | deployment-owned |
| memrez built-in LLM reasoner default | ✓ | ✓ | ✓ |
| memrez preload context policy | ✓ | ✓ | ✓ |
| Spawnable subagents | ✓ | not yet | ✓ |
| Skills (\`use_skill\` tool) | ✓ | not yet | ✓ |
| Reply tool (intermediate messages) | ✓ | persisted messages only | ✓ |
| Sessions | ✓ (memory or sqlite) | ✓ (memory or sqlite) | ✓ (managed) |
| Runs & traces | ✓ (ring buffer / sqlite) | ✓ (memory or sqlite) | ✓ (Postgres) |
| Local streaming for LLM agents | ✓ (full event stream) | start / complete snapshots | N/A |
| Hosted SSE streaming | ✓ | ✓ | ✓ |
| OpenTelemetry export | ✓ | not yet | ✓ |
| \`{{env.X}}\` template refs | ✓ | not yet | opt-in per server |
| \`{{secrets.X}}\` template refs | × | × | ✓ |
| Versioning + pinning | × | × | ✓ |
| Multi-user isolation | × | × | ✓ |
| API key auth | × | × | ✓ |
| Web UI (editor, playground, traces) | × | × | ✓ |
| Evals UI | × | × | roadmap |

## Migration paths

### Embedded → hosted

Most of the way is a constructor change (see [Embedded SDK → Switching to hosted](/docs/sdk-cli/sdk#switching-to-hosted)). The main fixes are:

- **Local tools** — promote to HTTP endpoints or MCP servers. The YAML \`tools:\` block is the only place the change is visible.
- **\`{{env.X}}\` → \`{{secrets.X}}\`** — multi-tenant workers do not share an environment with your code. Use \`{{secrets.X}}\` and configure values in **Settings → Secrets**.
- **Resources** — make sure the hosted worker has the same provider kinds wired server-side. Runtime \`context\` grants still come from trusted application code.

### TypeScript embedded → Python embedded

Keep the same YAML manifest. Translate only the host language code:

\`\`\`ts {group=compat-run}
await client.agents.run({
  agentId: "support",
  input: { message: "Hello" },
  sessionId: "user-42",
});
\`\`\`

\`\`\`python {group=compat-run}
client.agents.run(
    agent_id="support",
    input={"message": "Hello"},
    session_id="user-42",
)
\`\`\`

The Python SDK follows Python naming conventions, so wire names become \`agent_id\` and \`session_id\` while YAML fields remain unchanged.

Resource and memory APIs use the same pattern: TypeScript passes \`resources: { memory: memrez.provider() }\`; Python passes \`resources={"memory": memrez.provider()}\`. Both embedded runtimes support memrez's built-in LLM reasoner default plus agent-side \`preload\` config.

### Hosted → self-hosted

The hosted clients work against any worker — \`api.agntz.co\` or your own. Switch by setting \`baseUrl\` / \`base_url\` and using an API key minted on your self-hosted UI.

## Resources

- **GitHub:** [github.com/aparry3/agntz](https://github.com/aparry3/agntz) — source, issues, discussions.
- **npm:** \`@agntz/sdk\`, \`@agntz/client\`, \`@agntz/store-sqlite\`, \`@agntz/store-postgres\`, \`@agntz/manifest\`.
- **Python:** \`agntz\` package with optional \`agntz[litellm]\` local model support.
- **License:** MIT.
- **AI-friendly:** Every page exposes its raw markdown via the Copy button; the full corpus is at [/llms.txt](/llms.txt).
`;
