export default `# Self-host with Docker

The whole stack is open source under MIT. The fastest way to get it running on your own hardware is the bundled \`docker-compose.yml\` — it spins up Postgres, the worker, the app, and the marketing site in one command.

## What gets deployed

| Service | Role | Port |
|---|---|---|
| \`@agntz/app\` | Next.js 15 web UI (Clerk auth, agent editor, playground) | 3000 |
| \`@agntz/worker\` | Hono HTTP worker — executes agents, exposes \`/run\` and \`/run/stream\` | 4001 |
| Postgres | Backing store for sessions, runs, traces, agents | 5432 |
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
| \`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY\` | app | From Clerk Dashboard → API Keys |
| \`CLERK_SECRET_KEY\` | app | Same source |
| \`WORKER_INTERNAL_SECRET\` | app + worker | Must be identical on both. Generate with \`openssl rand -base64 32\`. |
| \`DATABASE_URL\` | app + worker | Defaults to the compose-provided Postgres. |
| \`OPENAI_API_KEY\` (or any provider key) | worker | At least one provider key for default models. |
| \`DEFAULT_MODEL_PROVIDER\`, \`DEFAULT_MODEL_NAME\` | worker | Fallback when an agent omits \`model:\`. |

## First-run flow

1. Open \`http://localhost:3000\`. Clerk shows sign-in / sign-up.
2. Sign up — every record from here on is scoped to your Clerk user id.
3. Hit **Create agent**, paste a description or write YAML directly, save.
4. Click **Playground**, run the agent, watch the trace.
5. Generate an API key in **Settings → API Keys**, then call your local worker from code:

\`\`\`ts
const client = new AgntzClient({
  apiKey: "ar_live_...",
  baseUrl: "http://localhost:4001",
});
\`\`\`

## Logs & data

- App logs: \`docker compose logs -f app\`
- Worker logs: \`docker compose logs -f worker\`
- Postgres data: the \`db_data\` named volume — \`docker volume inspect agntz_db_data\` to find it on disk.

## Resetting

To wipe local state and start fresh:

\`\`\`bash
docker compose down -v       # -v removes the Postgres volume
docker compose up
\`\`\`

## Production?

Compose is great for local dev and small internal deployments, but for a public deployment we recommend the split deploy on Vercel + Railway — see [Self-host in production](/docs/deploy/self-host-production).
`;
