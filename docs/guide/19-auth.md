# Auth & Multi-tenancy

agntz is multi-tenant by design. Every persisted record — agent, session, run, trace, API key — is scoped to a workspace owner key. In hosted Cloud, that key is the active Clerk organization id when one is selected, otherwise it falls back to the Clerk user id for a personal workspace. Two principles enforce this:

1. **Stores are scopable.** Every store implements `forUser(ownerKey)` which returns a view where every read filters and every write tags by the existing `user_id` column. The physical column name is kept for compatibility; hosted Cloud treats the value as a tenant/workspace owner key.
2. **The worker only accepts authenticated requests.** Auth modes resolve to the same owner key before invoking agents — there is no third way to invoke an agent over HTTP.

This chapter covers both. The actual cryptographic primitives (Clerk session tokens, signed app-to-worker identity, API key hashing) sit at the edges; agntz's job is to bridge them into one tenant owner key and scope everything downstream.

## Two auth modes

Inbound traffic to the worker is one of two flavours (`packages/worker/src/middleware/auth.ts:23-54`):

### Mode 1 — Internal (app → worker)

The Next.js app authenticates the user via Clerk on its side, resolves the active workspace, then forwards to the worker with a shared secret plus a short-lived signed tenant context:

```http
POST /runs HTTP/1.1
X-Internal-Secret: <WORKER_INTERNAL_SECRET>
X-Agntz-Internal-Auth: <signed tenant context>
Content-Type: application/json

{ "agentId": "support", "input": "…" }
```

Worker checks: `X-Internal-Secret` matches its configured secret, then verifies `X-Agntz-Internal-Auth`. The signed context contains the tenant owner key, actor user id, active org metadata, roles, permissions, `iat`, and `exp`. Legacy internal requests can still send `userId` in the JSON body or `X-User-Id` header as a fallback for tests and older integrations.

Used by:
- Every `/api/*` route in the Next.js app
- Future internal services that need to call agents on behalf of a known user

### Mode 2 — External (third-party API caller)

External clients (including `@agntz/client`) authenticate with a per-workspace API key:

```http
POST /runs HTTP/1.1
Authorization: Bearer ar_live_1a2b3c4d5e6f…
Content-Type: application/json

{ "agentId": "support", "input": "…" }
```

Worker hashes the raw key and looks it up via `ApiKeyStore.resolveApiKey(rawKey)`. If the key exists and is not revoked, the row's owner key becomes the request tenant.

Both modes converge:

```typescript
// packages/worker/src/middleware/auth.ts:37, 48
c.set("userId", tenantOwnerKey);
```

Every route handler reads the owner key via `getUserId(c)` and uses it to scope all subsequent operations. `getActorUserId(c)` is available for audit-style features that need the human actor behind an internal request.

## ScopableStore — the row-level filter

The scoping primitive in the core types (`packages/core/src/types.ts:831-846`):

```typescript
interface ScopableStore {
  forUser(userId: string): UnifiedStore;
  readonly userId: string | null;
}

type UnifiedStore = AgentStore &
  SessionStore &
  ContextStore &
  LogStore &
  ProviderStore &
  ConnectionStore &
  ApiKeyStore &
  RunStore &
  TraceStore &
  SkillStore &
  ScopableStore;
```

`store.forUser("org_abc")` returns a new `UnifiedStore` view where:

- Every read includes `WHERE user_id = 'org_abc'`.
- Every write sets `user_id = 'org_abc'`.
- Calling scoped methods on the *unscoped* store throws.

The route handler shape is therefore always:

```typescript
const ownerKey = getUserId(c);
const scoped = store.forUser(ownerKey);
await scoped.putAgent(definition);
```

This is the only way data crosses the user boundary. There is no "admin" read path in the runtime.

## API keys

API key management (`packages/core/src/types.ts:817-822`):

```typescript
interface ApiKeyStore {
  createApiKey(params: { userId: string; name: string }): Promise<{
    record: ApiKeyRecord;
    rawKey: string;  // returned ONCE on creation
  }>;
  listApiKeys(userId: string): Promise<ApiKeyRecord[]>;
  revokeApiKey(params: { userId: string; keyId: string }): Promise<void>;
  resolveApiKey(rawKey: string): Promise<{ userId: string; keyId: string } | null>;
}
```

`ApiKeyRecord` (`types.ts:801-809`):

```typescript
interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;       // first 8 chars — for display, e.g., "ar_live_1a2b3c4d"
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
```

- **Raw keys** look like `ar_live_<32 random bytes base64url>`.
- **At rest**, only the hash is stored. `resolveApiKey` re-hashes the inbound key and compares.
- **`keyPrefix`** is the first chunk of the raw key, stored cleartext so the UI can show "ar_live_1a2b3c4d… (revoked)" without exposing the secret.
- **Once-only display** — the raw key is shown to the user one time at creation. Lost? Make a new one.

The App exposes API key CRUD under `/settings` → API Keys. The handlers are normal Next.js routes that call API-key store methods with the active workspace owner key.

## Clerk wiring in the App

```typescript
// packages/app/src/middleware.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublic = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/health",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    await auth.protect();
  }
});
```

Every non-public request resolves a Clerk session before the page or API route runs. Inside any route:

```typescript
import { auth } from "@clerk/nextjs/server";

const authState = await auth();
const actorUserId = authState.userId;
const ownerKey = authState.orgId ?? actorUserId;
```

Clerk's active organization id is treated as agntz's workspace id. If no organization is active, the personal Clerk `userId` is the workspace id. This keeps existing personal-account data readable while enabling shared organization workspaces.

## End-to-end flow

```
Browser
  │  signed-in Clerk session cookie
  ▼
Next.js middleware (Clerk)
  │  auth.protect()  → actorUserId = "user_abc", orgId = "org_acme"
  ▼
/api/runs route handler
  │  fetch(WORKER_URL/runs, {
  │    headers: {
  │      "X-Internal-Secret": <secret>,
  │      "X-Agntz-Internal-Auth": sign({ tenantId: "org_acme", actorUserId: "user_abc" })
  │    },
  │    body: JSON.stringify({ agentId, input })
  │  })
  ▼
Worker — workerAuth middleware
  │  X-Internal-Secret matches → verify signed tenant context
  │  c.set("userId", "org_acme")
  ▼
Worker — POST /runs handler
  │  scoped = store.forUser("org_acme")
  │  runRegistry.create({ userId: "org_acme", … })
  │  runRegistry.start(run, executor)
  │  persistRun → scoped.putRun(run)
  ▼
TraceRegistry batches spans → scoped.insertSpan(span)  (span.ownerId = "org_acme")
RunStore.listRuns({ userId: "org_acme" }) is the only path that can read them
```

## Defensive scoping in handlers

Even though the store filters, route handlers double-check ownership where reads come from the in-memory `RunRegistry` rather than the store:

```typescript
// packages/worker/src/routes.ts:386-389
const live = runRegistry.get(runId);
if (live) {
  if (live.userId !== userId) {
    return c.json({ error: "Run not found" }, 404);   // 404, not 403 — don't leak existence
  }
  …
}
```

The registry is process-wide and serves multiple users; ownership has to be verified at the boundary. Same pattern in `POST /runs/:id/cancel`.

## What is NOT in scope

- **Physical tenant schema.** The runtime is tenant-aware, but the physical database columns are still named `user_id`. A future migration can rename/add `tenant_id` and `created_by_user_id` once the compatibility layer has settled.
- **Per-API-key scopes.** API keys are now workspace-scoped, but they still have full workspace access. A capability model — e.g., "this key can read traces but not create agents" — requires a permission field on `ApiKeyRecord` and per-route worker enforcement for external keys.
- **Full audit log.** Internal worker requests carry `actorUserId`, but there is not yet a persisted audit table for user/role/API-key/secret/agent changes.
- **Service-to-service impersonation.** Spawning a child agent runs in the same tenant context as the parent. There's no impersonation primitive.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/worker/src/middleware/auth.ts` | `workerAuth`, `internalOnlyAuth`, `getUserId`, `getActorUserId` |
| `packages/core/src/types.ts:801-846` | `ApiKeyStore`, `ApiKeyRecord`, `ScopableStore`, `UnifiedStore` |
| `packages/app/src/middleware.ts` | Clerk session enforcement + coarse RBAC gates |
| `packages/app/src/lib/user.ts` | Builds the tenant-aware app `UserContext` |
| `packages/app/src/lib/worker-client.ts` | Adds `X-Internal-Secret` + signed tenant context on worker calls |
| `packages/store-postgres/src/postgres-store.ts` | Owner-key filtering in SQL, currently via `user_id` columns |
