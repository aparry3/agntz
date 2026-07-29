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
- **Managed model operations** — text and structured generation, multimodal
  content, transcription, and image generation through one client.
- **Artifacts and retention** — tenant-scoped media with explicit
  \`none\`, \`result\`, or \`session\` persistence.

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

Every UI-side change is versioned. Runs using \`session\` retention are traced;
\`result\` stores a redacted durable result, and \`none\` intentionally leaves
no durable run, trace, or session data.

## Versioning

Every save creates a new version of the agent. Runs can resolve a bare id, \`@latest\`, an exact version timestamp, or an alias when aliases are configured. The version that produced any given run or trace is recorded, so you can jump from an observation back to the exact manifest that ran.

## Bring your own model keys

The worker calls OpenAI, Anthropic, Google, Mistral, or another configured
provider using the keys you save in **Settings → Connections**. In hosted mode,
request content necessarily passes through the Agntz worker so it can execute
the manifest. Choose an explicit retention mode to control what Agntz stores
after the call, and review the selected model provider's own data policy
separately.

For your own org's provider keys, set them at the workspace level. For per-tool secrets (e.g. an external API token used by an HTTP tool), set them in **Settings → Secrets** and reference them in YAML as \`{{secrets.NAME}}\`.

## API keys

Generate keys in **Settings → API Keys**. Keys are prefixed \`ar_live_\` and are scoped to the workspace that minted them. The worker sha256-hashes the key on receipt and resolves it to a user id — the plaintext key is never stored.

\`\`\`bash
# Use it
export AGNTZ_API_KEY=ar_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
agntz whoami
\`\`\`

Revoking a key disables it immediately; existing runs continue to completion.

## Use Agntz instead of a provider SDK

The hosted run API can own recursive structured-output schemas, common and
provider-specific model settings, ordered text/image/audio input, managed
artifacts, transcription, image generation, and signed callback tools. See
[Provider replacement](/docs/hosted/provider-replacement) for the migration
boundary and [Content, artifacts, and retention](/docs/hosted/content-artifacts-retention)
for storage behavior.

## Limits

The hosted edition has fair-use limits on:

- **Concurrent runs** per workspace
- **Run duration** (default cap; configurable on paid plans)
- **API requests per minute** (rate-limited; inspect \`AgntzError.status\` and
  retry-after metadata)

Self-host if you need higher limits or full control — see [Self-host in production](/docs/deploy/self-host-production).
`;
