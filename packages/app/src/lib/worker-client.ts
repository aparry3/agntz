import type { AgentManifest, ValidationResult } from "@agntz/manifest";

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
  userId: string;
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

export interface SystemAgentSummary {
  id: string;
  name: string;
  displayName: string;
  description?: string;
}

export interface SystemAgentDetail extends SystemAgentSummary {
  yaml: string;
  manifest: AgentManifest;
}

export interface ValidateRequest {
  userId: string;
  manifest: string;
  strict?: boolean;
  mcpTimeoutMs?: number;
}

/**
 * Validate a YAML manifest on the worker. The worker owns the full
 * validation context — local tools, user-scoped agent lookups, MCP
 * reachability — so the app just forwards the YAML and user id.
 */
export async function workerValidateManifest(req: ValidateRequest): Promise<ValidationResult> {
  const res = await fetch(`${WORKER_URL}/validate`, {
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

  return res.json() as Promise<ValidationResult>;
}

/**
 * List system agents bundled with the worker. These are global (not
 * user-scoped), so the endpoint only needs the internal secret.
 */
export async function workerListSystemAgents(): Promise<SystemAgentSummary[]> {
  const res = await fetch(`${WORKER_URL}/system/agents`, {
    headers: {
      "X-Internal-Secret": internalSecret(),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Worker error: ${res.status}`);
  }

  return res.json() as Promise<SystemAgentSummary[]>;
}

/**
 * Fetch a single system agent by id. Accepts either `agent-builder` or
 * `system:agent-builder`. Returns null when the worker responds 404.
 */
export async function workerGetSystemAgent(id: string): Promise<SystemAgentDetail | null> {
  const res = await fetch(`${WORKER_URL}/system/agents/${encodeURIComponent(id)}`, {
    headers: {
      "X-Internal-Secret": internalSecret(),
    },
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Worker error: ${res.status}`);
  }

  return res.json() as Promise<SystemAgentDetail>;
}
