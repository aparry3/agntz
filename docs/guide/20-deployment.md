# Deployment

The hosted agntz stack runs as four separate services. This chapter describes the production topology, the env-var contract, and the local-development mirror. For the step-by-step first-deploy checklist, see [`DEPLOY.md`](https://github.com/aparry3/agntz/blob/main/DEPLOY.md) at the repo root.

## Topology

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  agntz.co                    │        │  app.agntz.co                │
│  marketing site              │        │  Next.js app                  │
│  (packages/site)             │        │  (packages/app)               │
│  Vercel                       │        │  Vercel                       │
└──────────────────────────────┘        └──────────────┬───────────────┘
                                                       │  HTTPS
                                                       │  X-Internal-Secret
                                                       ▼
                                        ┌──────────────────────────────┐
                                        │  Worker                       │
                                        │  (packages/worker)            │
                                        │  Hono on Node                 │
                                        │  Railway                       │
                                        └──────────────┬───────────────┘
                                                       │  pg
                                                       ▼
                                        ┌──────────────────────────────┐
                                        │  Postgres                     │
                                        │  Railway                       │
                                        └──────────────────────────────┘
```

Four deployable units:

| Service | Package | Host | Purpose |
|---|---|---|---|
| `agntz.co` | `packages/site` | Vercel | Marketing |
| `app.agntz.co` | `packages/app` | Vercel | Product UI (Next.js + Clerk) |
| `<railway-domain>` | `packages/worker` | Railway | Agent execution (Hono) |
| Postgres | — | Railway | All persisted data |

The app and the worker share the same Postgres. The app uses it directly for CRUD on agents/sessions/api-keys/etc.; the worker uses it for the same things plus runs, traces, and logs. Both go through `store.forUser(userId)` — no service has unscoped access.

## What gets published vs. deployed

| Artifact | Where it goes |
|---|---|
| `@agntz/core`, `@agntz/manifest`, `@agntz/client`, `@agntz/store-postgres`, `@agntz/store-sqlite` | **npm** — published via changesets + GitHub Actions |
| `@agntz/worker` | Built and deployed as a service. Currently not published to npm (deployment-only) |
| `@agntz/app` | Same — deployed as a service |
| `@agntz/site` | Same |

External developers install the npm packages to embed agntz in their own apps. The worker/app/site code is open source but deployed only by the agntz team (or anyone who forks the repo).

## Env-var contract

### Worker

| Env var | Required | What |
|---|---|---|
| `STORE` | yes | `postgres` in prod; `memory` in dev |
| `DATABASE_URL` | when `STORE=postgres` | Railway Postgres private URL, e.g. `postgres://...railway.internal:5432/railway` |
| `MEMREZ_STORE` | no | `postgres`, `memory`, or `disabled`; defaults to `STORE` |
| `MEMREZ_DATABASE_URL` | no | Separate Postgres URL for memory; defaults to `DATABASE_URL` |
| `MEMREZ_TABLE_PREFIX` | no | Optional prefix for memrez tables |
| `PORT` | yes | `4001` |
| `WORKER_INTERNAL_SECRET` | yes | 32-byte random secret — **must match the app's value** |
| `DEFAULT_MODEL_PROVIDER` | yes | e.g. `openai` — used when an agent doesn't specify |
| `DEFAULT_MODEL_NAME` | yes | e.g. `gpt-4o` |
| `OPENAI_API_KEY` | one of | Fallback when user has no `ProviderConfig` for the provider |
| `ANTHROPIC_API_KEY` | one of | Same |
| `GOOGLE_GENERATIVE_AI_API_KEY` | one of | Same |

The worker prefers per-user `ProviderConfig` from `ProviderStore`. Env vars are the org-wide fallback so the system has *some* key to use if a user hasn't configured one.

### App

| Env var | Required | What |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk frontend key |
| `CLERK_SECRET_KEY` | yes | Clerk backend key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | yes | `/sign-up` |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | yes | `/agents` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | yes | `/agents` |
| `WORKER_URL` | yes | Worker public URL (Railway-provided domain) |
| `WORKER_INTERNAL_SECRET` | yes | **Same value as the worker's** |
| `STORE` | yes | `postgres` |
| `DATABASE_URL` | yes | Same Postgres as the worker, but reachable from Vercel; use the public TCP proxy URL, not `*.railway.internal` |
| `DEFAULT_MODEL_PROVIDER` | yes | e.g. `openai` |
| `DEFAULT_MODEL_NAME` | yes | e.g. `gpt-4o` |
| Provider keys (`OPENAI_API_KEY`, etc.) | one of | Same fallback role as the worker |

Two important sharing rules:

1. **`WORKER_INTERNAL_SECRET` must match** in both services. Mismatch = every app→worker call returns 401.
2. **The app and worker must use the same Postgres database**, but not necessarily the same hostname. The Railway worker can use the private `DATABASE_URL`; the Vercel app's `DATABASE_URL` must be Railway's public TCP proxy URL because Vercel is outside Railway's private network.

### Site

No env vars. It's a static marketing site.

## Schema initialization

The Postgres store auto-initializes its schema on boot:

```
worker starts
  ▼
PostgresStore connects
  ▼
acquire pg advisory lock
  ▼
check schema_version table → run any missing migration steps
  ▼
release lock
  ▼
worker accepts requests
```

This means deploying a new worker version with schema changes is zero-touch — the first instance to come up acquires the advisory lock, migrates, and releases. Other instances wait briefly and find an up-to-date schema. (See the [stores chapter](/guide/10-stores) for a deeper look at the migration system.)

There is no separate "migrate" CLI command. If you need to inspect or repair the schema, connect via `psql` directly.

## Publishing flow

Releases are driven by [Changesets](https://github.com/changesets/changesets):

```
developer writes code + adds a changeset
  ▼
PR merges to main
  ▼
.github/workflows/release.yml opens a "Version Packages" PR
  ▼
maintainer reviews + merges the Version PR
  ▼
release workflow runs `pnpm changeset publish`
  ▼
all 5 publishable @agntz/* packages go live on npm
  ▼
Railway + Vercel auto-deploy from main
```

The npm publish requires `NPM_TOKEN` as a GitHub Actions secret. Vercel and Railway auto-deploy on every `main` push by default.

## Local development

The dev stack mirrors prod minus the Vercel + Railway hops:

```bash
# Terminal 1 — worker
pnpm --filter @agntz/worker dev    # :4001

# Terminal 2 — app
pnpm --filter @agntz/app dev       # :3000

# Optional Terminal 3 — site
pnpm --filter @agntz/site dev      # :5173
```

`.env.local` at the repo root provides the env vars to both worker and app. Set `STORE=memory` to skip Postgres entirely for early prototyping, or run `docker-compose up postgres` (see `docker-compose.yml`) for a local Postgres mirror.

## Dockerfiles

The repo ships three Dockerfiles, one per service:

| File | Builds |
|---|---|
| `Dockerfile.worker` | The Hono worker (Node 22, multi-stage build, final stage starts `packages/worker/dist/server.js`) |
| `Dockerfile.app` | The Next.js app (standalone output) |
| `Dockerfile.site` | The static marketing site |

Railway uses `Dockerfile.worker`. Vercel uses native Next.js builds (no Docker), but the Dockerfiles let anyone host the same services elsewhere without forking the deploy logic.

## Costs

- **Railway** — $5 trial credit; production needs Hobby ($5/mo) or Pro ($20/mo). Postgres + worker are typically two services in one project.
- **Vercel** — Hobby tier is free for personal projects. Pro is $20/user/month if you need more bandwidth or seats.
- **Clerk** — Free up to 10k MAU; paid above.
- **LLM API** — Whatever your providers charge. Per-user `ProviderConfig` lets each user bring their own key — the platform doesn't have to pay for users' inference.

## Observability and SRE follow-ups

These are not built yet:

- **Application monitoring** — no Sentry / Datadog / Honeycomb integration. The OTel hook is available (see [chapter 21](/guide/21-telemetry)) but no shipping default.
- **Uptime checks** — no external pinger. `GET /health` on the worker and a 200-check on `app.agntz.co` are the obvious targets.
- **Metrics** — Vercel Analytics and Railway metrics are available out-of-the-box but not aggregated.
- **Alerting** — nothing.

Standing these up is part of any real production deployment beyond a personal project.

## Files cheatsheet

| File | What's there |
|---|---|
| `DEPLOY.md` | Step-by-step first-deploy checklist |
| `Dockerfile.worker`, `Dockerfile.app`, `Dockerfile.site` | Service builds |
| `docker-compose.yml` | Local Postgres + service mirror |
| `railway.json` | Railway service config |
| `.github/workflows/release.yml` | Changesets-driven npm publish |
| `packages/store-postgres/src/postgres-store.ts` | Schema init + advisory locks |
