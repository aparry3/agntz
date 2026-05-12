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
 * headers. Used by the runs detail + cancel routes to get registry-fresh
 * state and to invoke cancel via the in-memory RunRegistry. The list route
 * does not use this — it goes direct to the store.
 */
export async function workerRunsFetch(params: {
  userId: string;
  path: string; // begins with `/runs...`
  method?: "GET" | "POST";
  signal?: AbortSignal;
}): Promise<Response> {
  return fetch(`${WORKER_URL}${params.path}`, {
    method: params.method ?? "GET",
    headers: {
      "X-Internal-Secret": internalSecret(),
      "X-User-Id": params.userId,
    },
    signal: params.signal,
  });
}
