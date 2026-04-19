# @agntz/worker

Hono HTTP worker that executes YAML-defined agents via the manifest engine. User-scoped — every request resolves to a `user_id` before hitting the store.

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | none | Liveness probe |
| `POST` | `/run` | required | Execute an agent, return final output + state |
| `POST` | `/run/stream` | required | Same, as Server-Sent Events |

### Request shape

```json
{
  "userId": "user_abc...",   // only required when using X-Internal-Secret auth
  "agentId": "my-agent",
  "input": { "description": "..." }
}
```

Use `agentId: "system:<name>"` (e.g. `system:agent-builder`) to invoke a system agent bundled with the worker. System agents bypass the user store and run with ephemeral state.

## Authentication

Two modes are accepted by the `workerAuth` middleware in `src/middleware/auth.ts`:

### Internal (app → worker)

```
X-Internal-Secret: $WORKER_INTERNAL_SECRET
```

The worker trusts the header and reads `userId` from the request body. This is what `@agntz/app` uses when proxying a signed-in user's request.

### External (service → worker)

```
Authorization: Bearer ar_live_<token>
```

Keys are created in the app's **Settings → API Keys** UI (they're sha256-hashed in `ar_api_keys`). The worker calls `store.resolveApiKey(rawKey)` to map the token to its user.

Any request without one of these is rejected with 401.

## Env vars

```bash
PORT=4001
HOSTNAME=0.0.0.0
WORKER_INTERNAL_SECRET=...        # required
STORE=postgres                    # or memory (dev only)
DATABASE_URL=postgres://...       # when STORE=postgres
DEFAULT_MODEL_PROVIDER=openai
DEFAULT_MODEL_NAME=gpt-5.4-mini
BUILT_IN_AGENTS_DIR=...           # optional: extra YAMLs to seed per workspace
```

## System agents

Default agents shipped in `src/defaults/agents/` (currently `agent-builder/manifest.yaml`) are available as **system agents** — invoke with `agentId: "system:<name>"`. The worker loads the YAML from disk and runs it with an ephemeral `MemoryStore`, bypassing the caller's user-scoped store entirely. Each system agent gets its own directory so prompt assets (e.g. `schema-reference.md`) ship alongside the manifest. To change the behavior, edit files in the agent's directory and redeploy.

## Run locally

```bash
pnpm --filter @agntz/worker dev
```
