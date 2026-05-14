# The App

The **app** (`packages/app`, `@agntz/app`) is the Next.js 15 web UI for the hosted agntz product. It is a thin layer on top of the [Worker](/guide/16-worker): users sign in with Clerk, browse and edit agents, run them in a playground, and watch traces — but every execution call is proxied to the worker over HTTP. The app never instantiates an agent loop.

## What ships in the UI

The app's pages live under `packages/app/src/app/`:

| Path | What |
|---|---|
| `/agents` | List, create, edit agents |
| `/agents/new` | Create-agent form |
| `/agents/[id]` | Agent detail + editor |
| `/agents/[id]/playground` | Interactive chat playground |
| `/runs` | List user's Runs with filters |
| `/runs/:id` | Run detail with live replay of events |
| `/traces` | List user's traces |
| `/traces/:id` | Trace detail — Gantt + waterfall span view |
| `/sessions` | Conversation history |
| `/logs` | Per-invocation logs |
| `/tools` | Available tools (inline + MCP from user's connections) |
| `/system` | Bundled system agents (e.g., agent-builder) |
| `/settings` | API keys, MCP connections, provider keys |
| `/sign-in`, `/sign-up` | Clerk auth screens |

## The proxy boundary

```
Browser → Next.js app                         Worker
─────────────────────                        ──────
                                              
 fetch("/api/runs", { method: "POST" })  ──►  POST /runs
                                              X-Internal-Secret: <shared>
                                              userId: <Clerk userId>
```

Every page that needs execution data calls one of the app's `/api/*` routes (`packages/app/src/app/api/`). Those routes are Next.js server-side handlers that:

1. Read the Clerk session, extract `userId`.
2. Forward the request to the Worker via `packages/app/src/lib/worker-client.ts`.
3. Stream or return the response.

The app **never** imports `@agntz/core`'s runner or `@agntz/manifest`'s executor. It only imports SDK types and the worker-client helper. This is the boundary that makes scaling the worker independently possible — and it's what the PR-#13 cleanup enforced explicitly.

## API route inventory

The `/api/*` routes mirror the worker's surface, with Clerk userId injection:

| Path | Forwards to |
|---|---|
| `/api/run` | `POST /run` (one-shot synchronous) |
| `/api/runs` | `POST /runs`, `GET /runs`, plus stream/cancel sub-routes |
| `/api/traces` | `GET /traces`, `GET /traces/:id`, `DELETE /traces/:id`, stream |
| `/api/sessions` | Direct store reads — sessions are user-scoped data, no execution involved |
| `/api/logs` | Direct store reads |
| `/api/tools` | Lists registered tools the worker advertises |
| `/api/agents` | Direct store reads/writes for agent definitions |
| `/api/system` | Worker's `/system/agents/*` |
| `/api/api-keys` | Direct store via `ApiKeyStore` |
| `/api/connections` | Direct store via `ConnectionStore` |
| `/api/providers` | Direct store via `ProviderStore` |
| `/api/me` | Clerk user info |
| `/api/mcp-servers` | MCP servers the user has connected (from `ConnectionStore`) |
| `/api/health` | Public liveness — Clerk middleware excludes it |

Routes split into two patterns:

- **Execution routes** (`run`, `runs`, `traces` streams) — proxy to the worker, because the worker owns execution.
- **CRUD routes** (`agents`, `api-keys`, `connections`, `providers`, `sessions`, `logs`) — talk directly to the store. There's no execution involved, so going through the worker would be a needless hop. Both the app and the worker share the same Postgres backend via `STORE=postgres` + `DATABASE_URL`.

This split is intentional: going through the worker for execution preserves the auth + scoping boundary, while CRUD-only routes hit the shared store directly to avoid a needless hop.

## Multi-tenancy

Every page and every API route is gated by Clerk's `clerkMiddleware` (`packages/app/src/middleware.ts`):

```typescript
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

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/api/(.*)"],
};
```

Everything except `/sign-in`, `/sign-up`, and `/api/health` requires a Clerk session. The session's `userId` is the agntz `userId` — it scopes every store read and every proxied worker call.

See [the auth chapter](/guide/19-auth) for the full handshake.

## The worker-client

`packages/app/src/lib/worker-client.ts` is the single place that talks to the worker. The proxy adds two headers to every outbound request:

- `X-Internal-Secret: <env.WORKER_INTERNAL_SECRET>`
- userId — either in the JSON body field or via `X-User-Id`

Sketch:

```typescript
export async function workerRunStream(req: { agentId; input; sessionId? }) {
  const { userId } = await auth();          // Clerk
  if (!userId) throw new Error("unauthorized");

  const res = await fetch(`${process.env.WORKER_URL}/run/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.WORKER_INTERNAL_SECRET!,
    },
    body: JSON.stringify({ ...req, userId }),
  });
  return res.body!;  // raw SSE — page-level code parses
}
```

Streaming responses pass through unmodified — the App is a transparent SSE relay for `/run/stream`, `/runs/:id/stream`, and `/traces/:id/stream`.

## Components and hooks

UI is organized under `packages/app/src/`:

- `components/` — agent editors, tool catalog, trace waterfall, JSON viewer, log table, etc.
- `hooks/` — `useRunStream`, `useTraceStream`, `useSession` — wrap SSE plumbing into React-friendly state.

The trace UI in particular reads `TraceLiveEvent` from `/api/traces/:id/stream` and renders an in-progress Gantt that updates as spans open and close.

## Running locally

The app and worker are independent processes:

```bash
# Terminal 1
pnpm --filter @agntz/worker dev    # :4001

# Terminal 2  
pnpm --filter @agntz/app dev       # :3000
```

`.env.local` at the repo root needs:

```
CLERK_SECRET_KEY=sk_test_…
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…
WORKER_URL=http://localhost:4001
WORKER_INTERNAL_SECRET=<shared with worker>
STORE=memory                       # or postgres + DATABASE_URL
```

The full env contract for production is in the [deployment chapter](/guide/20-deployment).

## Files cheatsheet

| File | What's there |
|---|---|
| `packages/app/src/middleware.ts` | Clerk session enforcement, public route allowlist |
| `packages/app/src/app/` | All pages (file-based routing) |
| `packages/app/src/app/api/` | All API routes (proxy + direct-store) |
| `packages/app/src/lib/worker-client.ts` | The proxy boundary to the Worker |
| `packages/app/src/components/` | React UI components |
| `packages/app/src/hooks/` | SSE + state hooks |
