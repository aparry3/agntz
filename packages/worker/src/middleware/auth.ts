import type { Context, MiddlewareHandler } from "hono";
import type { UnifiedStore } from "@agent-runner/core";

export interface AuthDeps {
  store: UnifiedStore;
  internalSecret: string;
}

/**
 * Resolve the workspace for an inbound request. Two acceptable auth modes:
 *
 *   1. Internal: header `X-Internal-Secret: <WORKER_INTERNAL_SECRET>` plus
 *      `workspaceId` in the JSON body. Used by the Next.js app, which has
 *      already checked the user's Clerk session and resolved their workspace.
 *
 *   2. External: header `Authorization: Bearer ar_live_...`. The key is
 *      hashed and looked up in `ar_api_keys`; we set workspaceId from the row.
 *
 * On success: c.set("workspaceId", ...). On failure: 401.
 */
export function workerAuth(deps: AuthDeps): MiddlewareHandler {
  return async (c, next) => {
    const internalHeader = c.req.header("x-internal-secret");
    if (internalHeader && internalHeader === deps.internalSecret) {
      // Internal: read workspaceId from body. Cache the parsed body so the
      // handler can read it again.
      const body = await readJsonOnce(c);
      const workspaceId = (body as { workspaceId?: string } | undefined)?.workspaceId;
      if (!workspaceId || typeof workspaceId !== "string") {
        return c.json({ error: "internal request missing workspaceId in body" }, 400);
      }
      c.set("workspaceId", workspaceId);
      return next();
    }

    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const rawKey = authHeader.slice("Bearer ".length).trim();
      const resolved = await deps.store.resolveApiKey(rawKey);
      if (!resolved) {
        return c.json({ error: "invalid or revoked API key" }, 401);
      }
      c.set("workspaceId", resolved.workspaceId);
      return next();
    }

    return c.json({ error: "missing authentication" }, 401);
  };
}

/**
 * Read JSON body once and cache it on the context so subsequent c.req.json()
 * calls in the route handler return the same object. Hono's c.req.json() is
 * not idempotent across reads on Node.
 */
async function readJsonOnce(c: Context): Promise<unknown> {
  const cached = c.get("parsedBody" as never);
  if (cached !== undefined) return cached;
  const body = await c.req.json().catch(() => undefined);
  c.set("parsedBody" as never, body as never);
  return body;
}

export function getWorkspaceId(c: Context): string {
  const ws = c.get("workspaceId" as never) as string | undefined;
  if (!ws) throw new Error("workspaceId not set on context");
  return ws;
}

export function getCachedBody(c: Context): unknown {
  return c.get("parsedBody" as never);
}
