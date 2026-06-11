export default `# Self-host in production

Recommended split for a production self-hosted deployment: Next.js apps on **Vercel**, worker + Postgres on **Railway**.

The deployable surface is three packages:

| Package | Role | Where it goes |
|---|---|---|
| \`@agntz/app\` | Next.js 15 web UI (Clerk auth, agent editor, playground) | Vercel |
| \`@agntz/worker\` | Hono HTTP worker — executes agents | Railway |
| \`@agntz/store-postgres\` | Postgres store adapter — user-scoped tables | (used by worker + app) |

## 1. Provision Postgres on Railway

\`\`\`
Railway → New Project → Add Service → Database → PostgreSQL
\`\`\`

Copy the private \`DATABASE_URL\` and the public TCP proxy URL from the Variables tab. The worker uses the private \`DATABASE_URL\`; the Vercel app uses the public TCP proxy URL as its \`DATABASE_URL\` because it is outside Railway's private network. Schema is initialized on worker boot — no manual migration step.

## 2. Deploy the worker on Railway

Same Railway project → **Add Service** → **GitHub Repo** → select your fork.

- **Root directory:** \`/\`
- **Build:** Dockerfile, target stage \`worker\`
- **Port:** \`4001\`
- **Env vars:**
  - \`STORE=postgres\`
  - \`DATABASE_URL=\${{Postgres.DATABASE_URL}}\`
  - \`PORT=4001\`
  - \`WORKER_INTERNAL_SECRET=$(openssl rand -base64 32)\`
  - \`DEFAULT_MODEL_PROVIDER=openai\`
  - \`DEFAULT_MODEL_NAME=gpt-5.4\`
  - \`OPENAI_API_KEY=sk-...\`
  - (any other provider keys you'll use)

Generate a public domain in **Settings → Networking**; you'll need it for the app.

## 3. Set up Clerk

Sign up at clerk.com, create an application, copy the **Publishable** and **Secret** keys from the API Keys page. No Organizations setup needed.

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
DEFAULT_MODEL_NAME=gpt-5.4
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
 Browser ──(Clerk session)──► app (Next.js) ──(X-Internal-Secret + userId)──► worker (Hono)
 External caller ──(Bearer ar_live_...)─────────────────────────────────────► worker
                                                                                  │
                                                                                  ▼
                                                                        Postgres (user_id scoped)
\`\`\`

The worker accepts two auth modes:

- **Internal** — \`X-Internal-Secret\` header + \`userId\` in the request body. Used by the app on behalf of signed-in users.
- **External** — \`Authorization: Bearer ar_live_<token>\` from a key generated in **Settings → API Keys**. The worker sha256-hashes the key and resolves it to a \`user_id\`.

Every store row is scoped to a Clerk \`userId\`. The app never sees another user's data.

## Operating the deployment

- **Logs.** Railway streams worker logs in its UI; Vercel does the same for the app. Wire both into your observability stack if you have one.
- **Scaling.** The worker is stateless — scale it horizontally by raising Railway's replica count. The app is similarly stateless on Vercel.
- **Database.** A managed Postgres with daily backups is sufficient for most teams. Run migrations via worker boot only — we don't ship a separate migration runner.
- **Updating.** Push to your fork → Railway and Vercel auto-deploy. Pin the worker image tag if you want manual control over rollouts.

## See also

- **[HTTP API reference](/docs/deploy/http-api)** — endpoints the worker exposes.
- **[Hosted cloud](/docs/deploy/hosted-cloud)** — managed alternative.
`;
