import { type Runner, type UnifiedStore, createRunner } from "@agntz/core";
import { auth } from "@clerk/nextjs/server";
import { getStore } from "./store";

/**
 * Resolve the active user for the current request and return a store + Runner
 * scoped to their Clerk user id.
 *
 * Throws if the user isn't signed in.
 */
export interface UserContext {
	userId: string;
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
	const { userId } = await auth();
	if (!userId) throw new AuthRequiredError("Not signed in", 401);

	const adminStore = await getStore();
	const store = adminStore.forUser(userId);
	const runner = createRunner({
		store,
		defaults: {
			model: {
				provider: process.env.DEFAULT_MODEL_PROVIDER ?? "openai",
				name: process.env.DEFAULT_MODEL_NAME ?? "gpt-5.4-mini",
			},
		},
	});

	return { userId, store, runner };
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
