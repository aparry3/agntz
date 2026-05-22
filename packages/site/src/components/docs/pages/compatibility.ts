export default `# Compatibility matrix

What runs where, today. Embedded refers to \`@agntz/sdk\` (in-process). Hosted refers to both \`agntz.co\` and self-hosted workers (same codebase).

| Feature | Embedded (\`@agntz/sdk\`) | Hosted (\`agntz.co\` / self-host) |
|---|:---:|:---:|
| LLM agents | ✓ | ✓ |
| Sequential / parallel / tool kinds | ✓ | ✓ |
| Local tools (in-process JS/TS) | ✓ | (use MCP / HTTP instead) |
| HTTP tools | ✓ | ✓ |
| HTTP tools — OAuth2 / token exchange | ✓ | ✓ |
| MCP tools (raw URL + headers) | ✓ | ✓ |
| Agent-as-tool | ✓ | ✓ |
| Spawnable subagents | ✓ | ✓ |
| Skills (\`use_skill\` tool) | ✓ | ✓ |
| Reply tool (intermediate messages) | ✓ | ✓ |
| Sessions | ✓ (memory or sqlite) | ✓ (managed) |
| Runs & traces | ✓ (in-memory ring buffer) | ✓ (persisted in Postgres) |
| Streaming for LLM agents | ✓ (full event stream) | ✓ |
| Streaming for pipelines | ✓ (single \`complete\` event) | ✓ |
| OpenTelemetry export | ✓ | ✓ |
| \`{{env.X}}\` template refs | ✓ | (opt-in per server) |
| \`{{secrets.X}}\` template refs | × | ✓ |
| Versioning + pinning | × | ✓ |
| Multi-user isolation | × | ✓ |
| API key auth | × | ✓ |
| Web UI (editor, playground, traces) | × | ✓ |
| Evals UI | × | (roadmap) |

## Migration paths

### Embedded → hosted

Most of the way is a one-line code change (see [@agntz/sdk → Switching to hosted](/docs/sdk-cli/sdk#switching-to-hosted)). The two things you'll have to fix up:

- **Local tools** — promote to HTTP endpoints or MCP servers. The YAML \`tools:\` block is the only place the change is visible.
- **\`{{env.X}}\` → \`{{secrets.X}}\`** — multi-tenant workers don't share an environment with your code. Use \`{{secrets.X}}\` and configure values in **Settings → Secrets**.

### Hosted → self-hosted

The hosted client (\`@agntz/client\`) works against any worker — \`api.agntz.co\` or your own. Switch by setting \`baseUrl\` and using an API key minted on your self-hosted UI.

## Resources

- **GitHub:** [github.com/aparry3/agntz](https://github.com/aparry3/agntz) — source, issues, discussions.
- **npm:** \`@agntz/sdk\`, \`@agntz/client\`, \`@agntz/store-sqlite\`, \`@agntz/store-postgres\`, \`@agntz/manifest\`.
- **License:** MIT.
- **AI-friendly:** Every page exposes its raw markdown via the Copy button; the full corpus is at [/llms.txt](/llms.txt).
`;
