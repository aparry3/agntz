const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:4001";

function internalSecret(): string {
  const secret = process.env.WORKER_INTERNAL_SECRET;
  if (!secret) {
    throw new Error(
      "WORKER_INTERNAL_SECRET is not set. The app uses this to authenticate to the worker."
    );
  }
  return secret;
}

export interface RunRequest {
  workspaceId: string;
  agentId: string;
  input: unknown;
  sessionId?: string;
}

export interface RunResult {
  output: unknown;
  state: Record<string, unknown>;
}

/**
 * Call the worker's /run endpoint on behalf of a logged-in user. The worker
 * trusts X-Internal-Secret + the workspaceId in the body; external callers use
 * a per-workspace API key instead (see worker auth middleware).
 */
export async function workerRun(req: RunRequest): Promise<RunResult> {
  const res = await fetch(`${WORKER_URL}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret(),
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Worker error: ${res.status}`);
  }

  return res.json() as Promise<RunResult>;
}

/**
 * Call the worker's /run/stream endpoint. Returns a ReadableStream of SSE events.
 */
export async function workerRunStream(req: RunRequest): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${WORKER_URL}/run/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": internalSecret(),
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Worker error: ${res.status}`);
  }

  if (!res.body) {
    throw new Error("Worker returned no stream body");
  }

  return res.body;
}
