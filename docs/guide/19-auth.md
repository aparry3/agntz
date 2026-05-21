# Auth & Multi-tenancy

agntz is multi-tenant by design. Every persisted record — agent, session, run, trace, API key — is scoped to a `userId`. Two principles enforce this:

1. **Stores are scopable.** Every store implements `forUser(userId)` which returns a view where every read filters and every write tags by `user_id`. Unscoped methods on the underlying store throw.
2. **The worker only accepts authenticated requests.** Two auth modes resolve to a `userId` — there is no third way to invoke an agent over HTTP.

This chapter covers both. The actual cryptographic primitives (Clerk session tokens, API key hashing) sit at the edges; agntz's job is to bridge them into a single `userId` string and scope everything downstream.

## Two auth modes

Inbound traffic to the worker is one of two flavours (`packages/worker/src/middleware/auth.ts:23-54`):

### Mode 1 — Internal (app → worker)

The Next.js app authenticates the user via Clerk on its side, then forwards to the worker with a shared secret:

```http
POST /runs HTTP/1.1
X-Internal-Secret: <WORKER_INTERNAL_SECRET>
Content-Type: application/json

{ "agentId": "support", "userId": "user_2abc…", "input": "…" }
```

Worker checks: `X-Internal-Secret` matches its configured secret, then reads `userId` from the JSON body (or `X-User-Id` header as fallback). No further verification — the app already vouched.

Used by:
- Every `/api/*` route in the Next.js app
- Future internal services that need to call agents on behalf of a known user

### Mode 2 — External (third-party API caller)

External clients (including `@agntz/client`) authenticate with a per-user API key:

```http
POST /runs HTTP/1.1
Authorization: Bearer ar_live_1a2b3c4d5e6f…
Content-Type: application/json

{ "agentId": "support", "input": "…" }
```

Worker hashes the raw key and looks it up via `ApiKeyStore.resolveApiKey(rawKey)` (`packages/core/src/types.ts:821`). If the key exists and is not revoked, the row's `userId` becomes the request user.

Both modes converge:

```typescript
// packages/worker/src/middleware/auth.ts:37, 48
c.set("userId", userId);
```

Every route handler reads `userId` via `getUserId(c)` and uses it to scope all subsequent operations.

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

`store.forUser("user_abc")` returns a new `UnifiedStore` view where:

- Every read includes `WHERE user_id = 'user_abc'`.
- Every write sets `user_id = 'user_abc'`.
- Calling scoped methods on the *unscoped* store throws.

The route handler shape is therefore always:

```typescript
const userId = getUserId(c);
const scoped = store.forUser(userId);
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

The App exposes API key CRUD under `/settings` → API Keys. The handlers are normal Next.js routes that call `store.forUser(userId).createApiKey(...)` etc.

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

const { userId } = await auth();    // Clerk's user id — used directly as agntz userId
```

Clerk's `userId` is treated as agntz's `userId` — there's no separate mapping table. If a user is deleted in Clerk, their data in agntz becomes orphaned but invisible (no logged-in session can access it). A future "delete user data on Clerk webhook" is left to whoever stands up the deployment.

## End-to-end flow

```
Browser
  │  signed-in Clerk session cookie
  ▼
Next.js middleware (Clerk)
  │  auth.protect()  → userId = "user_abc"
  ▼
/api/runs route handler
  │  fetch(WORKER_URL/runs, {
  │    headers: { "X-Internal-Secret": <secret> },
  │    body: JSON.stringify({ agentId, input, userId })
  │  })
  ▼
Worker — workerAuth middleware
  │  X-Internal-Secret matches → read body.userId
  │  c.set("userId", "user_abc")
  ▼
Worker — POST /runs handler
  │  scoped = store.forUser("user_abc")
  │  runRegistry.create({ userId: "user_abc", … })
  │  runRegistry.start(run, executor)
  │  persistRun → scoped.putRun(run)
  ▼
TraceRegistry batches spans → scoped.insertSpan(span)  (span.ownerId = "user_abc")
RunStore.listRuns({ userId: "user_abc" }) is the only path that can read them
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

- **Organizations / teams.** Clerk supports them but the current data model is single-user. Adding teams means widening `userId` to `(orgId, userId)` and updating every `forUser(...)` call site to take both. Tracked but not built.
- **Per-API-key scopes.** Today an API key has the same permissions as its owning user. A capability model — e.g., "this key can read traces but not create agents" — would require a permission field on `ApiKeyRecord` and per-route enforcement.
- **Service-to-service auth between agents.** Spawning a child agent runs in the same `userId` context as the parent. There's no impersonation primitive.

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/worker/src/middleware/auth.ts` | `workerAuth`, `internalOnlyAuth`, `getUserId` |
| `packages/core/src/types.ts:801-846` | `ApiKeyStore`, `ApiKeyRecord`, `ScopableStore`, `UnifiedStore` |
| `packages/app/src/middleware.ts` | Clerk session enforcement |
| `packages/app/src/lib/worker-client.ts` | Adds `X-Internal-Secret` + `userId` on every outbound call |
| `packages/store-postgres/src/postgres-store.ts` | Per-user filtering in SQL |
