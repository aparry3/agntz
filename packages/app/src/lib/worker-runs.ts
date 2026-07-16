import { type WorkerIdentity, signWorkerIdentity } from "./internal-auth";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:4001";

function internalSecret(): string {
	const secret = process.env.WORKER_INTERNAL_SECRET;
	if (!secret) {
		throw new Error(
			"WORKER_INTERNAL_SECRET is not set. The app uses this to authenticate to the worker.",
		);
	}
	return secret;
}

/**
 * Forward a request to the worker, attaching the internal-secret + X-User-Id
 * headers. Used by all app-side Runs routes so list, detail, and cancel share
 * the worker's configured store and in-memory RunRegistry.
 */
export async function workerRunsFetch(params: {
	userId: string;
	actorUserId?: string;
	tenantId?: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles?: string[];
	permissions?: string[];
	path: string; // begins with `/runs...`
	method?: "GET" | "POST";
	signal?: AbortSignal;
}): Promise<Response> {
	const secret = internalSecret();
	const identity: WorkerIdentity = params;
	return fetch(`${WORKER_URL}${params.path}`, {
		method: params.method ?? "GET",
		headers: {
			"X-Internal-Secret": secret,
			"X-Agntz-Internal-Auth": signWorkerIdentity(identity, secret),
			"X-User-Id": params.userId,
		},
		signal: params.signal,
	});
}
