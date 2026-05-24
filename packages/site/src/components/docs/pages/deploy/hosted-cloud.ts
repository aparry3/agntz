export default `# Hosted cloud

The hosted edition at **agntz.co** gives you the same runtime plus a managed multi-tenant UI. Sign up, create an agent, run it — no infrastructure.

## What you get in the UI

- **Agent editor** — YAML manifest editor with live schema validation, plus AI-assisted build-from-description.
- **Playground** — per-agent interactive runner with SSE streaming, conversational sessions.
- **Sessions & logs** — browse conversation history and invocation traces with span detail.
- **Tool catalog** — list the inline / MCP tools available to your workspace.
- **Providers** — manage your LLM provider keys per workspace.
- **API keys** — generate \`ar_live_*\` keys for programmatic access from your apps.
- **Auth** — Clerk-backed sign-in / sign-up; every record is scoped to your \`userId\`.

## From UI to code in one step

Create an agent in the UI, then call it with the same SDK code you'd use locally — just point the SDK at the hosted worker:

\`\`\`ts {group=hosted-cloud-call}
import { AgntzClient } from "@agntz/client";

const client = new AgntzClient({
  apiKey: process.env.AGNTZ_API_KEY!,
  baseUrl: "https://api.agntz.co",
});

const { output } = await client.agents.run({
  agentId: "support-agent",     // the id you set in the UI editor
  input: { message: "Hello" },
});
\`\`\`

\`\`\`python {group=hosted-cloud-call}
import os
from agntz import AgntzClient

client = AgntzClient(
    api_key=os.environ["AGNTZ_API_KEY"],
    base_url="https://api.agntz.co",
)

result = client.agents.run(
    agent_id="support-agent",     # the id you set in the UI editor
    input={"message": "Hello"},
)
\`\`\`

Every UI-side change is versioned, every run is traced — same observability model as embedded.

## Versioning

Every save creates a new version of the agent. Production resolves \`support-agent\` to the **pinned** version; in-flight edits never reach users until you pin them. The version that produced any given trace is recorded with the trace, so you can jump from a run straight to the exact manifest that ran it.

## Bring your own model keys

agntz never proxies model calls. The worker calls OpenAI / Anthropic / Google / Mistral directly using the keys you configure in **Settings → Providers**. Your data goes from the worker to the provider and back; we don't see prompt or completion bodies.

For your own org's provider keys, set them at the workspace level. For per-tool secrets (e.g. an external API token used by an HTTP tool), set them in **Settings → Secrets** and reference them in YAML as \`{{secrets.NAME}}\`.

## API keys

Generate keys in **Settings → API Keys**. Keys are prefixed \`ar_live_\` and are scoped to the workspace that minted them. The worker sha256-hashes the key on receipt and resolves it to a user id — the plaintext key is never stored.

\`\`\`bash
# Use it
export AGNTZ_API_KEY=ar_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
agntz whoami
\`\`\`

Revoking a key disables it immediately; existing runs continue to completion.

## Limits

The hosted edition has fair-use limits on:

- **Concurrent runs** per workspace
- **Run duration** (default cap; configurable on paid plans)
- **API requests per minute** (rate-limited; see \`RateLimitError\` retry-after)

Self-host if you need higher limits or full control — see [Self-host in production](/docs/deploy/self-host-production).
`;
