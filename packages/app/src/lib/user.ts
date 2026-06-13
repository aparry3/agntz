import { type Runner, type UnifiedStore, createRunner } from "@agntz/core";
import { auth } from "@clerk/nextjs/server";
import {
	type AgntzPermission,
	type AgntzRole,
	normalizeAgntzRole,
	permissionsForRole,
} from "./authz";
import type { WorkerIdentity } from "./internal-auth";
import { getStore } from "./store";

/**
 * Resolve the active user for the current request and return a store + Runner
 * scoped to the active tenant.
 *
 * Compatibility note: `userId` remains the storage owner key used by the
 * current store interfaces. In hosted Cloud it is the active Clerk org id when
 * one is selected, otherwise it falls back to the Clerk user id for personal
 * workspaces. The human actor is exposed as `actorUserId`.
 *
 * Throws if the user isn't signed in.
 */
export interface UserContext {
	userId: string;
	actorUserId: string;
	tenantId: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles: AgntzRole[];
	permissions: AgntzPermission[];
	store: UnifiedStore;
	runner: Runner;
}

export class AuthRequiredError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export async function requireUserContext(): Promise<UserContext> {
	const authState = await auth();
	const actorUserId = authState.userId;
	if (!actorUserId) throw new AuthRequiredError("Not signed in", 401);

	const orgId = authState.orgId ?? undefined;
	const tenantId = orgId ?? actorUserId;
	const role = normalizeAgntzRole(authState.orgRole, Boolean(orgId));
	const permissions = permissionsForRole(role);

	const adminStore = await getStore();
	const store = adminStore.forUser(tenantId);
	const runner = createRunner({
		store,
		defaults: {
			model: {
				provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
				name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
			},
		},
	});

	return {
		userId: tenantId,
		actorUserId,
		tenantId,
		...(orgId ? { orgId } : {}),
		...(authState.orgSlug ? { orgSlug: authState.orgSlug } : {}),
		...(authState.orgRole ? { orgRole: authState.orgRole } : {}),
		roles: [role],
		permissions,
		store,
		runner,
	};
}

export function workerIdentity(ctx: UserContext): WorkerIdentity {
	return {
		userId: ctx.tenantId,
		actorUserId: ctx.actorUserId,
		tenantId: ctx.tenantId,
		...(ctx.orgId ? { orgId: ctx.orgId } : {}),
		...(ctx.orgSlug ? { orgSlug: ctx.orgSlug } : {}),
		...(ctx.orgRole ? { orgRole: ctx.orgRole } : {}),
		roles: ctx.roles,
		permissions: ctx.permissions,
		authMethod: "clerk",
	};
}

/**
 * Utility for routes: wraps a handler with UserContext injection and
 * converts AuthRequiredError into a JSON error response.
 */
export function withUser<T extends unknown[]>(
	handler: (ctx: UserContext, ...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
	return async (...args: T) => {
		try {
			const ctx = await requireUserContext();
			return await handler(ctx, ...args);
		} catch (err) {
			if (err instanceof AuthRequiredError) {
				return Response.json({ error: err.message }, { status: err.status });
			}
			return Response.json({ error: String(err) }, { status: 500 });
		}
	};
}
