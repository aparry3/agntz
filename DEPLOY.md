# Deploying agntz

Step-by-step checklist for the first production deployment after the `agent-runner` → `agntz` rename.

**What this covers:**
1. Publish the `@agntz/*` npm packages so external users can `npm install @agntz/core`.
2. Deploy the runtime stack so `agntz.co` (marketing) and `app.agntz.co` (product UI) go live.

**Hosting choices:**
- **npm** via changesets + GitHub Actions (already wired in `.github/workflows/release.yml`).
- **Worker + Postgres** on **Railway**.
- **App (Next.js UI) + Site (marketing)** on **Vercel** as two separate projects.
- **DNS** for `agntz.co` (you own the domain; records not yet configured).

**Legend:** 🧑 = manual step you do in a browser or terminal · 🤖 = a repo change to make (commit + PR).

---

## Phase 0 — Pre-deploy repo cleanup

Leftovers from the rename. Bundle these in a single PR.

- [ ] 🤖 Add `"publishConfig": { "access": "public" }` to `packages/manifest/package.json` (missing; other publishable packages have it — see `packages/store-postgres/package.json:46-48`).
- [ ] 🤖 Decide `@agntz/worker` publish status. It's currently not `"private": true` and has a `bin` entry, so changesets will publish it. **Recommended: add `"private": true`** to keep it internal for v0.1 — can be flipped later without breaking consumers.
- [ ] 🤖 Fix remaining `aparryopenclaw` references in docs:
  - [ ] `CONTRIBUTING.md:9` (git clone URL)
  - [ ] `docs/index.md:13` (GitHub link)
  - [ ] `docs/guide/ci-evals.md:44,54,67,101` (workflow references)
  - [ ] `docs/guide/templates.md:143` (`examples/gymtext` link — either repoint or remove)
- [ ] 🤖 Update `CHANGELOG.md` lines 3 and 7 (`agent-runner` → `agntz`).
- [ ] 🤖 Refresh `PUBLISH.md` — "Current State" table still lists unscoped `agntz` and a nonexistent `@agntz/studio`; update to reflect the 5 actual scoped packages.
- [ ] Open PR, get green CI, merge.

---

## Phase 1 — Publish `@agntz/*` packages to npm

### 1.1 npm account + org setup (one-time)

- [ ] 🧑 Confirm you have an npm account with **2FA enabled** (required for publishing).
- [ ] 🧑 Create the `@agntz` npm org: https://www.npmjs.com/org/create — pick **Free / Unlimited public packages**.
- [ ] 🧑 Generate an **Automation** token (not Publish — automation tokens bypass 2FA for CI): https://www.npmjs.com/settings/<your-username>/tokens/new
- [ ] 🧑 Add the token to GitHub Actions:
  ```sh
  gh secret set NPM_TOKEN --repo aparry3/agntz
  ```
  (Or via GitHub UI: Settings → Secrets and variables → Actions → New repository secret → `NPM_TOKEN`.) The release workflow already reads it at `.github/workflows/release.yml:48`.

### 1.2 Create the first changeset

- [ ] 🤖 From repo root on a new branch:
  ```sh
  pnpm changeset
  ```
  Select all 5 publishable packages (`@agntz/core`, `@agntz/manifest`, `@agntz/sdk`, `@agntz/store-postgres`, `@agntz/store-sqlite`). Bump **minor** for each (first real release). Write a short note ("First public release after rename from agent-runner").
- [ ] 🤖 Commit the generated `.changeset/<slug>.md`, open PR.

### 1.3 Release via CI

- [ ] 🧑 Merge the changeset PR to `main`.
- [ ] 🧑 The Release workflow opens a **"Version Packages"** PR — it bumps all 5 package versions and rewrites `workspace:*` peer deps to real version numbers. Review it.
- [ ] 🧑 Merge the Version Packages PR. On that merge, `pnpm changeset publish` runs and publishes to npm.
- [ ] 🧑 Verify each package is live:
  ```sh
  npm view @agntz/core version
  npm view @agntz/manifest version
  npm view @agntz/sdk version
  npm view @agntz/store-postgres version
  npm view @agntz/store-sqlite version
  ```
- [ ] 🧑 Smoke-test in a scratch dir:
  ```sh
  mkdir /tmp/agntz-test && cd /tmp/agntz-test
  npm init -y
  npm i @agntz/core @agntz/store-sqlite
  ```

> **If publish fails mid-flight:** npm won't let you re-publish the same version. Create a new changeset (patch bump) → new Version PR → merge.

---

## Phase 2 — Provision Postgres on Railway

- [ ] 🧑 Create account at https://railway.app (GitHub sign-in easiest).
- [ ] 🧑 New project → **Add Service** → **Database** → **PostgreSQL**.
- [ ] 🧑 In the Postgres service **Variables** tab, note the `DATABASE_URL` (format: `postgres://...@...railway.internal:5432/railway`).

> Schema is initialized on worker boot — no manual migration. If that turns out wrong, the bootstrap code is in `packages/store-postgres/src/`.

---

## Phase 3 — Deploy worker on Railway

### 3.1 Create the worker service

- [ ] 🧑 Same Railway project → **Add Service** → **GitHub Repo** → select `aparry3/agntz`.
- [ ] 🧑 Service **Settings**:
  - **Root directory:** `/` (Dockerfile is at repo root)
  - **Build:** Dockerfile
  - **Dockerfile target stage:** `worker` (matches `Dockerfile:37`)
  - **Start command:** *leave empty* — Dockerfile's `CMD` already runs `node packages/worker/dist/server.js`
  - **Port:** 4001

### 3.2 Generate the internal secret

- [ ] 🧑 Local terminal:
  ```sh
  openssl rand -base64 32
  ```
  Copy this. The **same value** goes in both worker and app env as `WORKER_INTERNAL_SECRET`.

### 3.3 Worker env vars (Railway → worker service → Variables)

- [ ] `STORE` = `postgres`
- [ ] `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway variable reference to the Postgres service)
- [ ] `PORT` = `4001`
- [ ] `WORKER_INTERNAL_SECRET` = output from 3.2
- [ ] `DEFAULT_MODEL_PROVIDER` = `openai` (or your choice)
- [ ] `DEFAULT_MODEL_NAME` = `gpt-4o` (or your choice)
- [ ] `OPENAI_API_KEY` = from https://platform.openai.com/api-keys
- [ ] `ANTHROPIC_API_KEY` = from https://console.anthropic.com/settings/keys *(optional)*
- [ ] Any additional provider keys from `.env.example:40-49` you need

### 3.4 Expose public URL

- [ ] 🧑 Worker service → **Settings** → **Networking** → **Generate Domain**. Copy the URL (e.g. `agntz-worker-production.up.railway.app`) — the app needs it.

### 3.5 Verify

- [ ] 🧑 Check logs for `server listening on port 4001`.
- [ ] 🧑 `curl https://<worker-domain>/` — should return a non-5xx response.

---

## Phase 4 — Deploy app on Vercel

### 4.1 Clerk setup (one-time)

- [ ] 🧑 Sign up at https://clerk.com → create an application (no Organizations needed).
- [ ] 🧑 From **API Keys**, copy **Publishable key** and **Secret key**.

### 4.2 Import repo on Vercel

- [ ] 🧑 https://vercel.com/new → import `aparry3/agntz`.
- [ ] Project settings:
  - **Framework preset:** Next.js (auto-detected)
  - **Root directory:** `packages/app`
  - **Build command:** default (`next build`)
  - **Install command:** `pnpm install` (auto-detected from `pnpm-lock.yaml`)
  - **Output directory:** default

> **If the build fails on workspace deps:** set build command to `cd ../.. && pnpm --filter @agntz/app build` and redeploy.

### 4.3 App env vars (Vercel → Project → Settings → Environment Variables)

Set for **Production** (and Preview if you want PR deploys to work):

- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (from 4.1)
- [ ] `CLERK_SECRET_KEY` (from 4.1)
- [ ] `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in`
- [ ] `NEXT_PUBLIC_CLERK_SIGN_UP_URL` = `/sign-up`
- [ ] `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` = `/agents`
- [ ] `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` = `/agents`
- [ ] `WORKER_URL` = Railway worker domain (from 3.4)
- [ ] `WORKER_INTERNAL_SECRET` = **same value as worker** (from 3.2)
- [ ] `STORE` = `postgres`
- [ ] `DATABASE_URL` = **same** Railway Postgres URL as the worker (copy manually — Vercel can't reference Railway variables)
- [ ] `DEFAULT_MODEL_PROVIDER` = `openai`
- [ ] `DEFAULT_MODEL_NAME` = `gpt-4o`
- [ ] `OPENAI_API_KEY` (and any other provider keys)

### 4.4 Deploy and verify

- [ ] 🧑 Deploy (push to `main` or click **Deploy**). Watch the build log.
- [ ] 🧑 Open the Vercel-provided URL (`<project>.vercel.app`).
- [ ] 🧑 Sign up via Clerk, try creating an agent.
- [ ] 🧑 Tail Railway worker logs to confirm the app reaches it with a valid `X-Internal-Secret`.

---

## Phase 5 — Deploy site on Vercel (marketing)

Same pattern, simpler — no env vars.

- [ ] 🧑 Vercel → **New Project** → import `aparry3/agntz` again (separate Vercel project from the app).
- [ ] Project settings:
  - **Root directory:** `packages/site`
  - **Framework preset:** Next.js
  - Install/build: defaults
- [ ] 🧑 Deploy. Open the Vercel URL to verify the marketing site renders.

---

## Phase 6 — DNS for agntz.co

Suggested scheme:

| Hostname | Points to | Purpose |
|---|---|---|
| `agntz.co` (apex) | site Vercel project | marketing |
| `www.agntz.co` | site Vercel project | marketing (alias) |
| `app.agntz.co` | app Vercel project | product UI |

- [ ] 🧑 In the **site** Vercel project → **Settings** → **Domains** → add `agntz.co` and `www.agntz.co`. Vercel shows required DNS records.
- [ ] 🧑 In the **app** Vercel project → **Domains** → add `app.agntz.co`.
- [ ] 🧑 At your domain registrar (where you bought `agntz.co`):
  - [ ] Remove any default parking records
  - [ ] Add the exact records Vercel listed (typically A record `76.76.21.21` for apex, CNAME `cname.vercel-dns.com` for subdomains)
- [ ] 🧑 Wait for propagation (usually <10 min, can be hours). Vercel auto-issues Let's Encrypt certs once DNS resolves.
- [ ] 🧑 In Clerk → **Domains** / **Paths** → add `https://app.agntz.co` as an allowed origin.
- [ ] 🧑 Swap Clerk **test keys** for **production keys** (Clerk dashboard → Instance → Production), update Vercel env vars, redeploy.

---

## Phase 7 — End-to-end verification

- [ ] 🧑 `https://agntz.co` loads the marketing site.
- [ ] 🧑 `https://app.agntz.co` loads the product, Clerk sign-up succeeds, lands on `/agents`.
- [ ] 🧑 Create a test agent, run it. Confirm worker logs show the request + valid `X-Internal-Secret` + the LLM provider key in use.
- [ ] 🧑 `npm view @agntz/core` shows `github.com/aparry3/agntz` and the correct version.
- [ ] 🧑 In a fresh scratch dir, install published packages and run one of the `examples/` agents against the npm versions (not workspace) — catches missing `dist/` or broken exports.

---

## Known risks / follow-ups

- **Vercel + pnpm `workspace:*`** — the app depends on `@agntz/core`, `@agntz/manifest`, `@agntz/store-postgres`, `@agntz/worker` as workspace packages (`packages/app/package.json:13-16`). Vercel's pnpm support should handle this; if builds fail, fallback is to switch app deps to published versions after Phase 1 — which would mean flipping `@agntz/worker` from private to published.
- **Railway pricing** — $5 trial credit depletes; production needs Hobby ($5/mo) or Pro ($20/mo).
- **Clerk keys** — dev keys (`pk_test_...`) work initially but rate-limit traffic. Must swap to production keys before launch.
- **No monitoring** — out of scope here. Next pass: Vercel Analytics, Railway metrics, Sentry, and an uptime check (e.g. BetterStack) against `app.agntz.co` and the worker health endpoint.
