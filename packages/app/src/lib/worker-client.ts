import type { EvalRun } from "@agntz/core";
import type {
	AgentManifest,
	ManifestSelection,
	ValidationResult,
} from "@agntz/manifest";
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

function internalHeaders(identity?: WorkerIdentity): Record<string, string> {
	const secret = internalSecret();
	return {
		"X-Internal-Secret": secret,
		...(identity
			? { "X-Agntz-Internal-Auth": signWorkerIdentity(identity, secret) }
			: {}),
	};
}

function internalJsonHeaders(identity: WorkerIdentity): Record<string, string> {
	return {
		"Content-Type": "application/json",
		...internalHeaders(identity),
	};
}

export interface RunRequest {
	userId: string;
	actorUserId?: string;
	tenantId?: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles?: string[];
	permissions?: string[];
	agentId: string;
	input: unknown;
	sessionId?: string;
	context?: string[];
	selection?: ManifestSelection;
}

export interface RunResult {
	output: unknown;
	state: Record<string, unknown>;
	sessionId?: string;
	replies?: unknown[];
	target?: "block";
	blockId?: string;
	blockKind?: string;
}

export interface EditAgentRequest {
	currentManifest: string;
	changeDescription: string;
	selection?: ManifestSelection;
}

export interface EditAgentResponse {
	yaml: string | null;
	explanation: string | null;
	validation: unknown;
}

export interface EvalRunRequest {
	userId: string;
	actorUserId?: string;
	tenantId?: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles?: string[];
	permissions?: string[];
	evalId: string;
	evalVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	agentVersion?: string;
	criterionIds?: string[];
}

/**
 * Call the worker's /run endpoint on behalf of a logged-in user. The worker
 * trusts X-Internal-Secret + the workspaceId in the body; external callers use
 * a per-workspace API key instead (see worker auth middleware).
 */
export async function workerRun(req: RunRequest): Promise<RunResult> {
	const res = await fetch(`${WORKER_URL}/run`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<RunResult>;
}

export async function workerRunBlock(req: RunRequest): Promise<RunResult> {
	const res = await fetch(`${WORKER_URL}/run/block`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<RunResult>;
}

export async function workerEvalRun(req: EvalRunRequest): Promise<EvalRun> {
	const res = await fetch(`${WORKER_URL}/eval-runs`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<EvalRun>;
}

export async function workerCancelEvalRun(
	identityOrUserId: WorkerIdentity | string,
	runId: string,
): Promise<EvalRun> {
	const identity =
		typeof identityOrUserId === "string"
			? { userId: identityOrUserId }
			: identityOrUserId;
	const userId = identity.tenantId ?? identity.userId;
	const res = await fetch(
		`${WORKER_URL}/eval-runs/${encodeURIComponent(runId)}/cancel`,
		{
			method: "POST",
			headers: internalJsonHeaders(identity),
			body: JSON.stringify({ userId }),
		},
	);

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<EvalRun>;
}

/**
 * Call the worker's /run/stream endpoint. Returns a ReadableStream of SSE events.
 */
export async function workerRunStream(
	req: RunRequest,
): Promise<ReadableStream<Uint8Array>> {
	const res = await fetch(`${WORKER_URL}/run/stream`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	if (!res.body) {
		throw new Error("Worker returned no stream body");
	}

	return res.body;
}

export async function workerRunBlockStream(
	req: RunRequest,
): Promise<ReadableStream<Uint8Array>> {
	const res = await fetch(`${WORKER_URL}/run/block/stream`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	if (!res.body) {
		throw new Error("Worker returned no stream body");
	}

	return res.body;
}

export async function workerEditAgent(
	req: EditAgentRequest & WorkerIdentity,
): Promise<EditAgentResponse> {
	const res = await fetch(`${WORKER_URL}/edit-agent`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<EditAgentResponse>;
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
	actorUserId?: string;
	tenantId?: string;
	orgId?: string;
	orgSlug?: string;
	orgRole?: string;
	roles?: string[];
	permissions?: string[];
	manifest: string;
	strict?: boolean;
	mcpTimeoutMs?: number;
}

/**
 * Validate a YAML manifest on the worker. The worker owns the full
 * validation context — local tools, user-scoped agent lookups, MCP
 * reachability — so the app just forwards the YAML and user id.
 */
export async function workerValidateManifest(
	req: ValidateRequest,
): Promise<ValidationResult> {
	const res = await fetch(`${WORKER_URL}/validate`, {
		method: "POST",
		headers: internalJsonHeaders(req),
		body: JSON.stringify(req),
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<ValidationResult>;
}

// ── Memory observability ──────────────────────────────────────────────────
// Wire types mirror @agntz/memrez. The app deliberately reads memory through
// the worker so there is exactly one authorization path: grants expand to
// scopes the same way they do for agent tools.

export interface MemoryTopicSummary {
	topic: string;
	count: number;
	blurb?: string;
	lastUpdatedAt: string;
	hasUncuratedWrites: boolean;
}

export interface MemoryEntryWire {
	id: string;
	scope: string;
	content: string;
	topics: string[];
	type: "fact" | "preference" | "event" | "summary";
	source?: { agentId?: string; sessionId?: string; runId?: string };
	status: "active" | "superseded";
	supersededBy?: string;
	createdAt: string;
	updatedAt: string;
}

export interface MemoryEntriesPage {
	entries: MemoryEntryWire[];
	total: number;
	limit: number;
	offset: number;
}

export async function workerMemoryTopics(
	grants: string[],
): Promise<{ grants: string[]; topics: MemoryTopicSummary[] }> {
	const params = new URLSearchParams({ grants: grants.join(",") });
	const res = await fetch(`${WORKER_URL}/memory/topics?${params}`, {
		headers: { "X-Internal-Secret": internalSecret() },
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<{
		grants: string[];
		topics: MemoryTopicSummary[];
	}>;
}

export async function workerMemoryEntries(req: {
	grants: string[];
	topics?: string[];
	includeSuperseded?: boolean;
	limit?: number;
	offset?: number;
}): Promise<MemoryEntriesPage> {
	const params = new URLSearchParams({ grants: req.grants.join(",") });
	if (req.topics?.length) params.set("topics", req.topics.join(","));
	if (req.includeSuperseded) params.set("includeSuperseded", "true");
	if (req.limit !== undefined) params.set("limit", String(req.limit));
	if (req.offset !== undefined) params.set("offset", String(req.offset));
	const res = await fetch(`${WORKER_URL}/memory/entries?${params}`, {
		headers: { "X-Internal-Secret": internalSecret() },
	});

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<MemoryEntriesPage>;
}

export async function workerMemoryCorrect(req: {
	grants: string[];
	id: string;
	content: string;
}): Promise<{ entry: MemoryEntryWire }> {
	const res = await fetch(
		`${WORKER_URL}/memory/entries/${encodeURIComponent(req.id)}/correct`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Secret": internalSecret(),
			},
			body: JSON.stringify({ grants: req.grants, content: req.content }),
		},
	);

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<{ entry: MemoryEntryWire }>;
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
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<SystemAgentSummary[]>;
}

/**
 * Fetch a single system agent by id. Accepts either `agent-builder` or
 * `system:agent-builder`. Returns null when the worker responds 404.
 */
export async function workerGetSystemAgent(
	id: string,
): Promise<SystemAgentDetail | null> {
	const res = await fetch(
		`${WORKER_URL}/system/agents/${encodeURIComponent(id)}`,
		{
			headers: {
				"X-Internal-Secret": internalSecret(),
			},
		},
	);

	if (res.status === 404) return null;

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error(
			(body as { error?: string }).error ?? `Worker error: ${res.status}`,
		);
	}

	return res.json() as Promise<SystemAgentDetail>;
}
