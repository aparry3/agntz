export default `# Self-host in production

Recommended split for a production self-hosted deployment: Next.js apps on **Vercel**, worker + Postgres on **Railway**.

The deployable surface is three packages:

| Package | Role | Where it goes |
|---|---|---|
| \`@agntz/app\` | Next.js 15 web UI (Clerk auth, agent editor, playground) | Vercel |
| \`@agntz/worker\` | Hono HTTP worker — executes agents | Railway |
| \`@agntz/stores\` | Postgres store adapter — user-scoped tables | (used by worker + app) |

## 1. Provision Postgres on Railway

\`\`\`
Railway → New Project → Add Service → Database → PostgreSQL
\`\`\`

Copy the private \`DATABASE_URL\` and the public TCP proxy URL from the Variables tab. The worker uses the private \`DATABASE_URL\`; the Vercel app uses the public TCP proxy URL as its \`DATABASE_URL\` because it is outside Railway's private network. Schema is initialized on worker boot — no manual migration step.

## 2. Deploy the worker on Railway

Same Railway project → **Add Service** → **GitHub Repo** → select your fork.

- **Root directory:** \`/\`
- **Build:** \`Dockerfile.worker\`
- **Port:** \`4001\`
- **Env vars:**
  - \`STORE=postgres\`
  - \`DATABASE_URL=\${{Postgres.DATABASE_URL}}\`
  - \`PORT=4001\`
  - \`WORKER_INTERNAL_SECRET=$(openssl rand -base64 32)\`
  - \`CORS_ORIGINS=https://<your-app-domain>\`
  - \`DEFAULT_MODEL_PROVIDER=openai\`
  - \`DEFAULT_MODEL_NAME=gpt-5.6-terra\`
  - \`OPENAI_API_KEY=sk-...\`
  - \`ARTIFACT_STORE=s3\`
  - \`ARTIFACT_S3_BUCKET=<private bucket>\`
  - \`ARTIFACT_S3_PREFIX=production\`
  - \`AWS_REGION=<bucket region>\`
  - \`MEMREZ_STORE=postgres\`
  - \`MEMREZ_REASONER=llm\`
  - \`MEMREZ_CURATE_INTERVAL=30m\` (optional)
  - (any other provider keys you'll use)

Generate a public domain in **Settings → Networking**; you'll need it for the app.

With \`STORE=postgres\`, the worker can wire the memrez memory provider against
Postgres. \`MEMREZ_CURATE_INTERVAL\` enables the worker's periodic dirty-topic
curation sweep; omit it if you prefer to call the memory curation endpoint or
library primitives from your own scheduler.

Provider-replacement workloads can upload as much as 50 MiB per artifact.
Configure the platform request-body limit accordingly. Use
\`ARTIFACT_S3_ENDPOINT\` and \`ARTIFACT_S3_FORCE_PATH_STYLE=true\` for
compatible object stores that require them; provide credentials through the
AWS SDK environment or workload identity. Keep the bucket private and add a
lifecycle policy as a deletion backstop.

The worker makes outbound calls to model providers, remote media URLs, MCP/HTTP
tools, and signed callback endpoints. Production defaults reject localhost and
private-network destinations. Callback receivers must verify HMAC, timestamp,
and delivery id before using the trusted run/session context.

## 3. Set up Clerk

Sign up at clerk.com, create an application, copy the **Publishable** and **Secret** keys from the API Keys page. Enable **Organizations** for hosted Cloud-style workspaces, role-based access, and enterprise SSO.

## 4. Deploy the app on Vercel

\`\`\`
Vercel → New Project → Import your repo
- Root directory: packages/app
- Framework preset: Next.js
\`\`\`

Env vars:

\`\`\`
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/agents
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/agents
WORKER_URL=https://<your-worker>.up.railway.app
WORKER_INTERNAL_SECRET=...           # MUST match the worker
STORE=postgres
DATABASE_URL=...                     # Railway public TCP proxy URL
DEFAULT_MODEL_PROVIDER=openai
DEFAULT_MODEL_NAME=gpt-5.6-terra
OPENAI_API_KEY=sk-...
\`\`\`

\`WORKER_INTERNAL_SECRET\` must be identical on both sides — the app authenticates to the worker with it.

Do not set Vercel's \`DATABASE_URL\` to a Railway \`*.railway.internal\` URL. That hostname only resolves inside Railway.

## 5. (Optional) Deploy the marketing site on Vercel

The marketing site at \`packages/site\` is a separate Vercel project — no env vars required.

\`\`\`
Root directory: packages/site
\`\`\`

## 6. DNS

Suggested layout for a custom domain:

| Hostname | Project | Purpose |
|---|---|---|
| \`yourdomain.com\` | site | Marketing |
| \`www.yourdomain.com\` | site | Marketing (alias) |
| \`app.yourdomain.com\` | app | Product UI |

In your registrar, add the records Vercel lists (typically A \`76.76.21.21\` for apex, CNAME \`cname.vercel-dns.com\` for subdomains). Vercel auto-issues certs once DNS resolves.

In Clerk → **Domains** — add the production URL as an allowed origin, swap test keys for production keys, redeploy.

## Architecture

\`\`\`
 Browser ──(Clerk session + active org)──► app (Next.js) ──(signed tenant context)──► worker (Hono)
 External caller ──(Bearer ar_live_...)─────────────────────────────────────► worker
                                                                                  │
                                                                                  ▼
                                                                        Postgres (tenant-owner scoped)
\`\`\`

The worker accepts two auth modes:

- **Internal** — \`X-Internal-Secret\` header + \`X-Agntz-Internal-Auth\` signed tenant context. Used by the app on behalf of signed-in workspaces.
- **External** — \`Authorization: Bearer ar_live_<token>\` from a key generated in **Settings → API Keys**. The worker sha256-hashes the key and resolves it to a workspace owner key.

Every store row is scoped to the active Clerk organization id, falling back to the Clerk \`userId\` for personal workspaces. The app never sees another workspace's data.

## Operating the deployment

- **Logs.** Railway streams worker logs in its UI; Vercel does the same for the app. Wire both into your observability stack if you have one.
- **Scaling.** With Postgres plus S3 artifact storage, the worker is stateless
  enough to scale horizontally by raising Railway's replica count. Do not use
  filesystem artifacts across replicas.
- **Database.** A managed Postgres with daily backups is sufficient for most teams. Run migrations via worker boot only — we don't ship a separate migration runner.
- **Retention.** Run-record and artifact TTLs are independent. Monitor expired
  metadata/object cleanup and align object lifecycle rules with the longest
  allowed artifact TTL.
- **Updating.** Push to your fork → Railway and Vercel auto-deploy. Pin the worker image tag if you want manual control over rollouts.

## See also

- **[HTTP API reference](/docs/deploy/http-api)** — endpoints the worker exposes.
- **[Hosted cloud](/docs/deploy/hosted-cloud)** — managed alternative.
- **[Provider replacement](/docs/hosted/provider-replacement)** — application
  migration boundary and hosted operation contract.
`;
