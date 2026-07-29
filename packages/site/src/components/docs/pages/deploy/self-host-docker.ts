export default `# Self-host with Docker

The whole stack is open source under MIT. The fastest way to get it running on your own hardware is the bundled \`docker-compose.yml\` — it spins up Postgres, the worker, the app, and the marketing site in one command.

## What gets deployed

| Service | Role | Port |
|---|---|---|
| \`@agntz/app\` | Next.js 15 web UI (Clerk auth + organizations, agent editor, playground) | 3000 |
| \`@agntz/worker\` | Hono HTTP worker — executes agents, model operations, artifacts, runs, traces, memory, and eval records | 4001 |
| Postgres | Backing store for agents, artifact metadata, sessions, runs, and traces | 5432 |
| \`@agntz/site\` | Marketing site (optional) | 3001 |

## One-command bootstrap

\`\`\`bash
git clone https://github.com/aparry3/agntz
cd agntz
cp .env.example .env.local
# fill in CLERK_*, WORKER_INTERNAL_SECRET, OPENAI_API_KEY
docker compose up
\`\`\`

UI at \`http://localhost:3000\`, worker at \`http://localhost:4001\`.

## Required env vars

The \`.env.example\` lists every variable. The non-optional ones:

| Variable | Where used | Notes |
|---|---|---|
| \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\` | app | From Clerk Dashboard → API Keys. Enable Organizations for shared workspaces. |
| \`CLERK_SECRET_KEY\` | app | Same source |
| \`WORKER_INTERNAL_SECRET\` | app + worker | Must be identical on both. Generate with \`openssl rand -base64 32\`. |
| \`CORS_ORIGINS\` | worker | Comma-separated browser origins allowed to call the API. Defaults include local development. |
| \`DATABASE_URL\` | app + worker | Defaults to the compose-provided Postgres. |
| \`OPENAI_API_KEY\` (or any provider key) | worker | At least one provider key for default models. |
| \`DEFAULT_MODEL_PROVIDER\`, \`DEFAULT_MODEL_NAME\` | worker | Fallback when an agent omits \`model:\`. |
| \`MEMREZ_STORE\` | worker | Optional. Defaults from \`STORE\`; set \`postgres\` to force Postgres-backed memory. |
| \`MEMREZ_REASONER\` | worker | Optional. \`llm\` by default; \`deterministic\` is the emergency no-LLM fallback. |
| \`MEMREZ_CURATE_INTERVAL\` | worker | Optional. Enables periodic memory curation, e.g. \`30m\` or \`1h\`. |
| \`ARTIFACT_STORE\` | worker | \`memory\` for disposable development, \`filesystem\` for one persistent worker, or \`s3\` for replicas. |

When \`STORE=postgres\`, the worker wires the memrez memory resource provider by
default. Agents that declare \`resources.memory\` can use \`memory_read\` and
\`memory_write\`; curation runs only when \`MEMREZ_CURATE_INTERVAL\` is set or
when you call the curation endpoint manually.

## Managed artifact storage

Transcription inputs, multimodal image/audio content, and generated images use
the artifact store. Compose defaults to in-memory blobs unless you set:

\`\`\`bash
# One persistent worker; mount ARTIFACT_DIR as a durable volume.
ARTIFACT_STORE=filesystem
ARTIFACT_DIR=/var/lib/agntz/artifacts
\`\`\`

For more than one worker replica, use a private S3-compatible bucket:

\`\`\`bash
ARTIFACT_STORE=s3
ARTIFACT_S3_BUCKET=agntz-artifacts
ARTIFACT_S3_PREFIX=production
ARTIFACT_S3_ENDPOINT=               # omit for AWS S3
ARTIFACT_S3_FORCE_PATH_STYLE=false
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
\`\`\`

Uploads are capped at 50 MiB. Configure a bucket lifecycle rule as a cleanup
backstop, and keep the bucket private because downloads are authorized through
the worker. See
[Content, artifacts, and retention](/docs/hosted/content-artifacts-retention).

## First-run flow

1. Open \`http://localhost:3000\`. Clerk shows sign-in / sign-up.
2. Sign up, then optionally create or switch to an organization from the sidebar.
   Records are scoped to the active organization; personal workspaces fall back to your Clerk user id.
3. Hit **Create agent**, paste a description or write YAML directly, save.
4. Click **Playground**, run the agent, watch the trace.
5. Generate an API key in **Settings → API Keys**, then call your local worker from code:

\`\`\`ts
const client = new AgntzClient({
  apiKey: "ar_live_...",
  baseUrl: "http://localhost:4001",
});
\`\`\`

For a provider-replacement smoke test, import one \`transcription\` or \`image\`
example, exercise an artifact upload/download, and verify the effective
\`none\` / \`result\` / \`session\` retention mode in the normalized result.

## Logs & data

- App logs: \`docker compose logs -f app\`
- Worker logs: \`docker compose logs -f worker\`
- Postgres data: the \`pgdata\` named volume — \`docker volume inspect agntz_pgdata\` to find it on disk.

## Resetting

To wipe local state and start fresh:

\`\`\`bash
docker compose down -v       # -v removes the Postgres volume
docker compose up
\`\`\`

## Production?

Compose is great for local dev and small internal deployments, but for a public deployment we recommend the split deploy on Vercel + Railway — see [Self-host in production](/docs/deploy/self-host-production).
`;
