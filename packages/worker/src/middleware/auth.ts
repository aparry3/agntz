import type { Context, MiddlewareHandler } from "hono";
import type { UnifiedStore } from "@agntz/core";

export interface AuthDeps {
  store: UnifiedStore;
  internalSecret: string;
}

/**
 * Resolve the user for an inbound request. Two acceptable auth modes:
 *
 *   1. Internal: header `X-Internal-Secret: <WORKER_INTERNAL_SECRET>` plus
 *      `userId` in the JSON body. Used by the Next.js app, which has already
 *      verified the user's Clerk session.
 *
 *   2. External: header `Authorization: Bearer ar_live_...`. The key is
 *      hashed and looked up in `ar_api_keys`; we set userId from the row.
 *
 * On success: c.set("userId", ...). On failure: 401.
 */
export function workerAuth(deps: AuthDeps): MiddlewareHandler {
  return async (c, next) => {
    const internalHeader = c.req.header("x-internal-secret");
    if (internalHeader && internalHeader === deps.internalSecret) {
      const body = await readJsonOnce(c);
      const userId = (body as { userId?: string } | undefined)?.userId;
      if (!userId || typeof userId !== "string") {
        return c.json({ error: "internal request missing userId in body" }, 400);
      }
      c.set("userId", userId);
      return next();
    }

    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const rawKey = authHeader.slice("Bearer ".length).trim();
      const resolved = await deps.store.resolveApiKey(rawKey);
      if (!resolved) {
        return c.json({ error: "invalid or revoked API key" }, 401);
      }
      c.set("userId", resolved.userId);
      return next();
    }

    return c.json({ error: "missing authentication" }, 401);
  };
}

/**
 * Header-only internal auth for requests without a body (e.g. GETs).
 * Accepts only the internal secret; external API keys are not allowed
 * because the routes gated by this middleware return resources that
 * aren't user-scoped (e.g. system agents bundled with the worker).
 */
export function internalOnlyAuth(deps: { internalSecret: string }): MiddlewareHandler {
  return async (c, next) => {
    const h = c.req.header("x-internal-secret");
    if (h !== deps.internalSecret) {
      return c.json({ error: "missing or invalid internal secret" }, 401);
    }
    return next();
  };
}

/**
 * Read JSON body once and cache it on the context so subsequent c.req.json()
 * calls in the route handler return the same object.
 */
async function readJsonOnce(c: Context): Promise<unknown> {
  const cached = c.get("parsedBody" as never);
  if (cached !== undefined) return cached;
  const body = await c.req.json().catch(() => undefined);
  c.set("parsedBody" as never, body as never);
  return body;
}

export function getUserId(c: Context): string {
  const u = c.get("userId" as never) as string | undefined;
  if (!u) throw new Error("userId not set on context");
  return u;
}

export function getCachedBody(c: Context): unknown {
  return c.get("parsedBody" as never);
}
