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
 * Open the worker's /traces/:id/stream as a body-less GET and return the
 * raw response. The caller is responsible for piping the body. Uses the
 * internal-secret + X-User-Id auth path.
 */
export async function workerTraceStream(params: {
  userId: string;
  traceId: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const url = `${WORKER_URL}/traces/${encodeURIComponent(params.traceId)}/stream`;
  return fetch(url, {
    method: "GET",
    headers: {
      "X-Internal-Secret": internalSecret(),
      "X-User-Id": params.userId,
      Accept: "text/event-stream",
    },
    signal: params.signal,
  });
}
