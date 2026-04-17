# @agntz/app

Hosted web UI for agntz. Next.js 15 App Router + Tailwind + Clerk auth + per-user data scoping. Pairs with `@agntz/worker` for agent execution.

## Features

- **Agent editor** — YAML manifest editor with live validation + AI-assisted build-from-description
- **Playground** — per-agent interactive runner with SSE streaming
- **Sessions & logs** — browse conversation history and invocation traces
- **Tool catalog** — list available inline / MCP tools
- **Providers** — per-user LLM API key management
- **API keys** — per-user programmatic auth for external apps
- **Auth** — Clerk sign-in / sign-up
- **Scoping** — every row in the store is scoped to the Clerk `userId`

## Architecture

```
 Browser ──(Clerk session)──► app (Next.js, :3000) ──(X-Internal-Secret + userId)──► worker (Hono, :4001)
 External caller ──(Bearer ar_live_...)────────────────────────────────────────────────► worker
                                                             │
                                                             ▼
                                                   Postgres (ar_* tables, user_id scoped)
```

The app serves browser requests, resolves the signed-in user's Clerk `userId`, and either handles CRUD itself (store reads/writes) or proxies to the worker for `/run` and `/run/stream`. The worker can also be called directly by external services using an `ar_live_...` API key created in **Settings → API Keys**.

## Local setup

### 1. Clerk dev app

Sign up at https://clerk.com → create an app. Copy `Publishable key` + `Secret key` from the API Keys page. No Organizations setup needed.

### 2. Postgres

```bash
docker run -d --name ar-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
```

### 3. `.env.local` at repo root

See `.env.example`. Minimum:

```bash
STORE=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

WORKER_URL=http://localhost:4001
WORKER_INTERNAL_SECRET=$(openssl rand -base64 32)

OPENAI_API_KEY=sk-...   # or any provider you use
```

### 4. Run

```bash
pnpm --filter @agntz/worker dev    # :4001
pnpm --filter @agntz/app dev       # :3000
```

Sign up at http://localhost:3000, then create an agent.

## How scoping works

Every API route calls `requireUserContext()` from `@/lib/user`, which:

1. Reads `userId` from Clerk's session
2. Returns a user-scoped `UnifiedStore` via `adminStore.forUser(userId)` plus a fresh `Runner` wired to it

The worker's `workerAuth` middleware accepts two authentication modes:

- **Internal** — `X-Internal-Secret: $WORKER_INTERNAL_SECRET` header + `userId` in the JSON body. Used by the app when calling `/run` on behalf of the signed-in user.
- **External** — `Authorization: Bearer ar_live_...` header. The key is sha256'd and resolved to a `user_id`.

## System agents

`agent-builder.yaml` (the agent that powers the "Create from description" UI) ships in the repo at `packages/worker/src/defaults/agents/`. It's invoked via `agentId: "system:agent-builder"` — the worker detects the `system:` prefix, loads the YAML from disk, and runs with an ephemeral in-memory store. It bypasses the user's store entirely. To tweak the prompt, edit the YAML and redeploy.

## Deployment

Planned: Vercel (app) + Railway (worker) + Neon (Postgres) on `agntz.co`. See the repo's planning docs.

## Related packages

| Package | Description |
|---|---|
| [`@agntz/core`](../core) | The underlying SDK |
| [`@agntz/worker`](../worker) | Hono HTTP worker consumed by this app |
| [`@agntz/store-postgres`](../store-postgres) | Production store used in deployment |
