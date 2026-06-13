import type { UnifiedStore } from "@agntz/core";
import type { Context, MiddlewareHandler } from "hono";
import { verifyInternalAuthToken } from "./internal-auth.js";

export interface AuthDeps {
	store: UnifiedStore;
	internalSecret: string;
}

/**
 * Resolve the user for an inbound request. Two acceptable auth modes:
 *
 *   1. Internal: header `X-Internal-Secret: <WORKER_INTERNAL_SECRET>` plus a
 *      signed `X-Agntz-Internal-Auth` tenant context. Legacy callers may still
 *      provide `userId` in the JSON body OR an `X-User-Id` header. Used by the
 *      Next.js app, which has already verified the user's Clerk session.
 *
 *   2. External: header `Authorization: Bearer ar_live_...`. The key is
 *      hashed and looked up in `ar_api_keys`; we set userId from the row.
 *
 * On success: c.set("userId", tenant owner key). On failure: 401 (missing
 * auth) or 400 (internal auth without a resolvable userId).
 */
export function workerAuth(deps: AuthDeps): MiddlewareHandler {
	return async (c, next) => {
		const internalHeader = c.req.header("x-internal-secret");
		if (internalHeader && internalHeader === deps.internalSecret) {
			const signedIdentity = c.req.header("x-agntz-internal-auth");
			if (signedIdentity) {
				const claims = verifyInternalAuthToken(
					signedIdentity,
					deps.internalSecret,
				);
				if (!claims) {
					return c.json({ error: "invalid internal auth token" }, 401);
				}
				setAuthContext(c, {
					userId: claims.tenantId,
					actorUserId: claims.actorUserId,
					tenantId: claims.tenantId,
					orgId: claims.orgId,
					orgRole: claims.orgRole,
					orgSlug: claims.orgSlug,
					roles: claims.roles,
					permissions: claims.permissions,
					authMethod: claims.authMethod,
				});
				return next();
			}

			const body = await readJsonOnce(c);
			const bodyUserId = (body as { userId?: string } | undefined)?.userId;
			const headerUserId = c.req.header("x-user-id");
			const userId =
				(typeof bodyUserId === "string" && bodyUserId) || headerUserId;
			if (!userId) {
				return c.json(
					{
						error:
							"internal request missing userId in body or X-User-Id header",
					},
					400,
				);
			}
			setAuthContext(c, {
				userId,
				actorUserId: userId,
				tenantId: userId,
				roles: [],
				permissions: [],
				authMethod: "internal",
			});
			return next();
		}

		const authHeader = c.req.header("authorization");
		if (authHeader?.startsWith("Bearer ")) {
			const rawKey = authHeader.slice("Bearer ".length).trim();
			const resolved = await deps.store.resolveApiKey(rawKey);
			if (!resolved) {
				return c.json({ error: "invalid or revoked API key" }, 401);
			}
			setAuthContext(c, {
				userId: resolved.userId,
				actorUserId: resolved.userId,
				tenantId: resolved.userId,
				roles: [],
				permissions: [],
				authMethod: "api_key",
			});
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
export function internalOnlyAuth(deps: {
	internalSecret: string;
}): MiddlewareHandler {
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

export function getActorUserId(c: Context): string {
	const u = c.get("actorUserId" as never) as string | undefined;
	if (!u) return getUserId(c);
	return u;
}

export function getCachedBody(c: Context): unknown {
	return c.get("parsedBody" as never);
}

function setAuthContext(
	c: Context,
	ctx: {
		userId: string;
		actorUserId: string;
		tenantId: string;
		orgId?: string;
		orgRole?: string;
		orgSlug?: string;
		roles: string[];
		permissions: string[];
		authMethod: "clerk" | "internal" | "api_key";
	},
) {
	c.set("userId" as never, ctx.userId as never);
	c.set("actorUserId" as never, ctx.actorUserId as never);
	c.set("tenantId" as never, ctx.tenantId as never);
	c.set("roles" as never, ctx.roles as never);
	c.set("permissions" as never, ctx.permissions as never);
	c.set("authMethod" as never, ctx.authMethod as never);
	if (ctx.orgId) c.set("orgId" as never, ctx.orgId as never);
	if (ctx.orgRole) c.set("orgRole" as never, ctx.orgRole as never);
	if (ctx.orgSlug) c.set("orgSlug" as never, ctx.orgSlug as never);
}
