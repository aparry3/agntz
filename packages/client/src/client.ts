import { StreamError } from "./errors.js";
import {
	normalizeEvent,
	normalizeRunEvent,
	normalizeTraceLiveEvent,
} from "./events.js";
import { composeSignal, sendFormRequest, sendRequest } from "./fetch.js";
import { parseSSE } from "./sse.js";
import type {
	AgentDefinition,
	AgentImportInput,
	AgentImportResponse,
	AgentSummary,
	AgntzClientOptions,
	ArtifactRef,
	ContentBlock,
	EvalDataset,
	EvalDatasetListFilter,
	EvalDefinition,
	EvalLatestScore,
	EvalLatestScoreKey,
	EvalLatestScoreListFilter,
	EvalListFilter,
	EvalRun,
	EvalRunInput,
	EvalRunListFilter,
	EvalRunListResult,
	HealthResult,
	MemoryCurateResult,
	MemoryDeleteEntryResult,
	MemoryEntriesPage,
	MemoryEntry,
	MemoryImportInput,
	MemoryImportResponse,
	MemoryListOptions,
	MemoryReadOptions,
	MemoryScanResult,
	MultiplexedRunEvent,
	Run,
	RunInput,
	RunListFilter,
	RunListResult,
	RunResult,
	RunsStartInput,
	RunsStreamInput,
	ScopeDeleteResult,
	SessionDetail,
	SessionImportInput,
	SessionImportResponse,
	SessionSummary,
	StreamEvent,
	TraceDetail,
	TraceFilter,
	TraceLiveEvent,
	TracesListResult,
} from "./types.js";

export class AgntzClient {
	readonly agents: AgentsResource;
	readonly artifacts: ArtifactsResource;
	readonly datasets: DatasetsResource;
	readonly evals: EvalsResource;
	readonly memory: MemoryResource;
	readonly runs: RunsResource;
	readonly sessions: SessionsResource;
	readonly traces: TracesResource;
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;
	private readonly defaultSignal?: AbortSignal;

	constructor(opts: AgntzClientOptions) {
		if (!opts.apiKey) throw new Error("AgntzClient: apiKey is required");
		if (!opts.baseUrl) throw new Error("AgntzClient: baseUrl is required");
		this.apiKey = opts.apiKey;
		this.baseUrl = opts.baseUrl;
		this.fetchImpl = opts.fetch ?? fetch;
		this.defaultSignal = opts.defaultSignal;
		this.agents = new AgentsResource(this);
		this.artifacts = new ArtifactsResource(this);
		this.datasets = new DatasetsResource(this);
		this.evals = new EvalsResource(this);
		this.memory = new MemoryResource(this);
		this.runs = new RunsResource(this);
		this.sessions = new SessionsResource(this);
		this.traces = new TracesResource(this);
	}

	/** @internal */
	get _apiKey(): string {
		return this.apiKey;
	}
	/** @internal */
	get _baseUrl(): string {
		return this.baseUrl;
	}
	/** @internal */
	get _fetchImpl(): typeof fetch {
		return this.fetchImpl;
	}
	/** @internal */
	_composeSignal(signal?: AbortSignal): AbortSignal | undefined {
		return composeSignal(this.defaultSignal, signal);
	}

	async health(): Promise<HealthResult> {
		const res = await sendRequest({
			baseUrl: this.baseUrl,
			path: "/health",
			method: "GET",
			fetchImpl: this.fetchImpl,
			signal: this.defaultSignal,
		});
		return (await res.json()) as HealthResult;
	}

	/** @internal */
	async _runRequest(input: RunInput, stream: boolean): Promise<Response> {
		const signal = composeSignal(this.defaultSignal, input.signal);
		const body = await this._prepareRunBody(input);
		return sendRequest({
			baseUrl: this.baseUrl,
			path: stream ? "/run/stream" : "/run",
			method: "POST",
			apiKey: this.apiKey,
			body,
			signal,
			accept: stream ? "text/event-stream" : undefined,
			fetchImpl: this.fetchImpl,
		});
	}

	/** @internal */
	async _prepareRunBody(input: RunInput | RunsStartInput) {
		const body: Record<string, unknown> = { agentId: input.agentId };
		const legacyContent =
			input.content === undefined && isContentBlocks(input.input)
				? input.input
				: undefined;
		const content = input.content ?? legacyContent;
		if (input.input !== undefined && !legacyContent) body.input = input.input;
		if (content !== undefined) {
			body.content = await this.artifacts._prepareContent(
				content,
				input.retention?.artifactTtlSeconds,
				input.signal,
			);
		}
		if (input.sessionId !== undefined) body.sessionId = input.sessionId;
		if (input.context !== undefined) body.context = input.context;
		if (input.retention !== undefined) body.retention = input.retention;
		return body;
	}

	/** @internal */
	_resolveStreamSignal(input: RunInput): AbortSignal | undefined {
		return composeSignal(this.defaultSignal, input.signal);
	}
}

export class AgentsResource {
	constructor(private readonly client: AgntzClient) {}

	async list(opts: { signal?: AbortSignal } = {}): Promise<AgentSummary[]> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/agents",
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as AgentSummary[];
	}

	async get(
		agentId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<AgentDefinition> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/agents/${encodeURIComponent(agentId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as AgentDefinition;
	}

	async import(input: AgentImportInput): Promise<AgentImportResponse> {
		const signal = this.client._composeSignal(input.signal);
		const { signal: _signal, ...body } = input;
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/agents/import",
			method: "POST",
			apiKey: this.client._apiKey,
			body,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as AgentImportResponse;
	}

	async run(input: RunInput): Promise<RunResult> {
		const res = await this.client._runRequest(input, false);
		return (await res.json()) as RunResult;
	}

	stream(input: RunInput): AsyncGenerator<StreamEvent, void, void> {
		return streamAgentEvents(this.client, input);
	}

	/** Start an asynchronous agent run using the same input contract as run(). */
	start(input: RunsStartInput): Promise<Run> {
		return this.client.runs.start(input);
	}
}

export class ArtifactsResource {
	constructor(private readonly client: AgntzClient) {}

	async upload(input: {
		file:
			| Blob
			| ArrayBuffer
			| Uint8Array
			| { path: string; mediaType?: string; filename?: string };
		purpose?: "input" | "output";
		expiresInSeconds?: number;
		mediaType?: string;
		filename?: string;
		signal?: AbortSignal;
	}): Promise<ArtifactRef> {
		const { blob, filename } = await artifactInputToBlob(
			input.file,
			input.mediaType,
			input.filename,
		);
		const form = new FormData();
		form.append("file", blob, filename);
		form.append("purpose", input.purpose ?? "input");
		if (input.expiresInSeconds !== undefined) {
			form.append("expiresInSeconds", String(input.expiresInSeconds));
		}
		const res = await sendFormRequest({
			baseUrl: this.client._baseUrl,
			path: "/artifacts",
			method: "POST",
			apiKey: this.client._apiKey,
			form,
			signal: this.client._composeSignal(input.signal),
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as ArtifactRef;
	}

	async get(
		artifactId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<ArtifactRef> {
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/artifacts/${encodeURIComponent(artifactId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal: this.client._composeSignal(opts.signal),
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as ArtifactRef;
	}

	async download(
		artifactId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<Blob> {
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/artifacts/${encodeURIComponent(artifactId)}/content`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal: this.client._composeSignal(opts.signal),
			fetchImpl: this.client._fetchImpl,
		});
		return res.blob();
	}

	async delete(
		artifactId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<void> {
		await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/artifacts/${encodeURIComponent(artifactId)}`,
			method: "DELETE",
			apiKey: this.client._apiKey,
			signal: this.client._composeSignal(opts.signal),
			fetchImpl: this.client._fetchImpl,
		});
	}

	/** @internal */
	async _prepareContent(
		content: ContentBlock[],
		expiresInSeconds?: number,
		signal?: AbortSignal,
	): Promise<ContentBlock[]> {
		return Promise.all(
			content.map(async (block) => {
				if (!("file" in block)) return block;
				const artifact = await this.upload({
					file: block.file,
					purpose: "input",
					expiresInSeconds,
					mediaType: block.mediaType,
					signal,
				});
				const { file: _file, ...wire } = block;
				return { ...wire, artifactId: artifact.id } as ContentBlock;
			}),
		);
	}
}

export class SessionsResource {
	constructor(private readonly client: AgntzClient) {}

	async import(input: SessionImportInput): Promise<SessionImportResponse> {
		const signal = this.client._composeSignal(input.signal);
		const { signal: _signal, ...body } = input;
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/sessions/import",
			method: "POST",
			apiKey: this.client._apiKey,
			body,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as SessionImportResponse;
	}

	async list(
		filter: { agentId?: string } = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<SessionSummary[]> {
		const signal = this.client._composeSignal(opts.signal);
		const params = new URLSearchParams();
		if (filter.agentId) params.set("agentId", filter.agentId);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: params.toString() ? `/sessions?${params}` : "/sessions",
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return ((await res.json()) as { sessions: SessionSummary[] }).sessions;
	}

	async get(
		sessionId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<SessionDetail> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/sessions/${encodeURIComponent(sessionId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as SessionDetail;
	}

	/** Erase a session and everything linked to it (messages, logs, runs, traces). */
	async delete(
		sessionId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<void> {
		const signal = this.client._composeSignal(opts.signal);
		await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/sessions/${encodeURIComponent(sessionId)}`,
			method: "DELETE",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
	}
}

export class MemoryResource {
	constructor(private readonly client: AgntzClient) {}

	async import(input: MemoryImportInput): Promise<MemoryImportResponse> {
		const signal = this.client._composeSignal(input.signal);
		const { signal: _signal, ...body } = input;
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/memory/import",
			method: "POST",
			apiKey: this.client._apiKey,
			body,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as MemoryImportResponse;
	}

	/** Topics visible to `grants` (mirrors `@agntz/sdk` `client.memory.scan`). */
	async scan(
		grants: string[],
		opts: { signal?: AbortSignal } = {},
	): Promise<MemoryScanResult> {
		const signal = this.client._composeSignal(opts.signal);
		const params = new URLSearchParams({ grants: grants.join(",") });
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/memory/topics?${params}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as MemoryScanResult;
	}

	/**
	 * Entries for one or more topics visible to `grants`. Note: unlike the SDK's
	 * per-topic `read`, `limit` here caps the TOTAL entries across all topics
	 * (hosted `/memory/entries` semantics), and an omitted limit is clamped to the
	 * worker default (200).
	 */
	async read(
		grants: string[],
		topic: string | string[],
		opts: MemoryReadOptions = {},
	): Promise<MemoryEntry[]> {
		const topics = Array.isArray(topic) ? topic : [topic];
		const page = await this.listPage(grants, {
			topics,
			limit: opts.limit,
			signal: opts.signal,
		});
		return page.entries;
	}

	/** Every entry visible to `grants` (optionally filtered/paginated). */
	async list(
		grants: string[],
		opts: MemoryListOptions = {},
	): Promise<MemoryEntry[]> {
		return (await this.listPage(grants, opts)).entries;
	}

	private async listPage(
		grants: string[],
		opts: MemoryListOptions,
	): Promise<MemoryEntriesPage> {
		const signal = this.client._composeSignal(opts.signal);
		const params = new URLSearchParams({ grants: grants.join(",") });
		if (opts.topics?.length) params.set("topics", opts.topics.join(","));
		if (opts.includeSuperseded) params.set("includeSuperseded", "true");
		if (opts.limit !== undefined) params.set("limit", String(opts.limit));
		if (opts.offset !== undefined) params.set("offset", String(opts.offset));
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/memory/entries?${params}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as MemoryEntriesPage;
	}

	/** Hard-delete a single entry. Grants ride the query string (DELETE bodies are unreliable). */
	async deleteEntry(
		grants: string[],
		id: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<MemoryDeleteEntryResult> {
		const signal = this.client._composeSignal(opts.signal);
		const params = new URLSearchParams({ grants: grants.join(",") });
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/memory/entries/${encodeURIComponent(id)}?${params}`,
			method: "DELETE",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as MemoryDeleteEntryResult;
	}

	async correct(
		grants: string[],
		id: string,
		content: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<{ entry: MemoryEntry }> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/memory/entries/${encodeURIComponent(id)}/correct`,
			method: "POST",
			apiKey: this.client._apiKey,
			body: { grants, content },
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as { entry: MemoryEntry };
	}

	async curate(
		grants: string[],
		opts: { topics?: string[]; signal?: AbortSignal } = {},
	): Promise<MemoryCurateResult> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/memory/curate",
			method: "POST",
			apiKey: this.client._apiKey,
			body: { grants, ...(opts.topics ? { topics: opts.topics } : {}) },
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as MemoryCurateResult;
	}

	/**
	 * Erase a namespace scope across every resource (memrez now, RAG later).
	 * `recursive` defaults to **false** (single scope), matching `@agntz/sdk`'s
	 * `deleteScope` — pass `{ recursive: true }` to erase the whole subtree. The
	 * worker bounds `prefix` to the API key's registered roots; `grants` is
	 * advisory on the hosted path (sent for signature parity with the SDK;
	 * authorization is by registered roots).
	 */
	async deleteScope(
		grants: string[],
		prefix: string,
		opts: { recursive?: boolean; signal?: AbortSignal } = {},
	): Promise<ScopeDeleteResult> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/scopes/delete",
			method: "POST",
			apiKey: this.client._apiKey,
			// Always send an explicit boolean so the worker's recursive-by-default
			// can't silently turn a single-scope delete into a subtree wipe.
			body: { scope: prefix, grants, recursive: opts.recursive ?? false },
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as ScopeDeleteResult;
	}
}

export class DatasetsResource {
	constructor(private readonly client: AgntzClient) {}

	async list(
		filter: EvalDatasetListFilter = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDataset[]> {
		const signal = this.client._composeSignal(opts.signal);
		const params = new URLSearchParams();
		if (filter.agentId) params.set("agentId", filter.agentId);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: params.toString() ? `/datasets?${params}` : "/datasets",
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDataset[];
	}

	async create(
		dataset: Partial<EvalDataset>,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDataset> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/datasets",
			method: "POST",
			apiKey: this.client._apiKey,
			body: dataset,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDataset;
	}

	async get(
		datasetId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDataset> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/datasets/${encodeURIComponent(datasetId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDataset;
	}

	async update(
		datasetId: string,
		patch: Partial<EvalDataset>,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDataset> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/datasets/${encodeURIComponent(datasetId)}`,
			method: "PUT",
			apiKey: this.client._apiKey,
			body: patch,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDataset;
	}

	async delete(
		datasetId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<void> {
		const signal = this.client._composeSignal(opts.signal);
		await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/datasets/${encodeURIComponent(datasetId)}`,
			method: "DELETE",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
	}
}

export class EvalsResource {
	constructor(private readonly client: AgntzClient) {}

	async list(
		filter: EvalListFilter = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDefinition[]> {
		const signal = this.client._composeSignal(opts.signal);
		const params = new URLSearchParams();
		if (filter.agentId) params.set("agentId", filter.agentId);
		const path = params.toString() ? `/evals?${params}` : "/evals";
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDefinition[];
	}

	async create(
		definition: Partial<EvalDefinition>,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDefinition> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/evals",
			method: "POST",
			apiKey: this.client._apiKey,
			body: definition,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDefinition;
	}

	async get(
		evalId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDefinition> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/evals/${encodeURIComponent(evalId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDefinition;
	}

	async update(
		evalId: string,
		patch: Partial<EvalDefinition>,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalDefinition> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/evals/${encodeURIComponent(evalId)}`,
			method: "PUT",
			apiKey: this.client._apiKey,
			body: patch,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalDefinition;
	}

	async delete(
		evalId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<void> {
		const signal = this.client._composeSignal(opts.signal);
		await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/evals/${encodeURIComponent(evalId)}`,
			method: "DELETE",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
	}

	async run(input: EvalRunInput): Promise<EvalRun> {
		const signal = this.client._composeSignal(input.signal);
		const body: Record<string, unknown> = { evalId: input.evalId };
		if (input.datasetId !== undefined) body.datasetId = input.datasetId;
		if (input.agentVersion !== undefined)
			body.agentVersion = input.agentVersion;
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/eval-runs",
			method: "POST",
			apiKey: this.client._apiKey,
			body,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalRun;
	}

	async getRun(
		runId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalRun> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/eval-runs/${encodeURIComponent(runId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalRun;
	}

	async cancelRun(
		runId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalRun> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/eval-runs/${encodeURIComponent(runId)}/cancel`,
			method: "POST",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalRun;
	}

	async listRuns(
		filter: EvalRunListFilter = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalRunListResult> {
		const signal = this.client._composeSignal(opts.signal);
		const params = encodeEvalRunFilter(filter);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: params ? `/eval-runs?${params}` : "/eval-runs",
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalRunListResult;
	}

	async getLatestScore(
		key: EvalLatestScoreKey,
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalLatestScore | null> {
		const signal = this.client._composeSignal(opts.signal);
		const params = encodeEvalLatestScoreFilter(key);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/eval-scores/latest?${params}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalLatestScore | null;
	}

	async listLatestScores(
		filter: EvalLatestScoreListFilter = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<EvalLatestScore[]> {
		const signal = this.client._composeSignal(opts.signal);
		const params = encodeEvalLatestScoreFilter(filter);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: params ? `/eval-scores?${params}` : "/eval-scores",
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as EvalLatestScore[];
	}
}

export class RunsResource {
	constructor(private readonly client: AgntzClient) {}

	/** Start a run and return its handle immediately (status: "running"). */
	async start(input: RunsStartInput): Promise<Run> {
		const signal = this.client._composeSignal(input.signal);
		const body = await this.client._prepareRunBody(input);
		if (input.callbackUrl !== undefined) body.callbackUrl = input.callbackUrl;
		if (input.webhookSecretName !== undefined)
			body.webhookSecretName = input.webhookSecretName;
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: "/runs",
			method: "POST",
			apiKey: this.client._apiKey,
			body,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as Run;
	}

	/** Fetch the current state of a Run (live registry or durable store). */
	async get(runId: string, opts: { signal?: AbortSignal } = {}): Promise<Run> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/runs/${encodeURIComponent(runId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as Run;
	}

	/**
	 * Stream multiplexed events for a Run's subtree. Pass `since` to resume
	 * from a specific seq after a reconnect. If the Run has been evicted, the
	 * stream emits a single `snapshot` event and closes.
	 */
	stream(
		input: RunsStreamInput,
	): AsyncGenerator<MultiplexedRunEvent, void, void> {
		return streamRunEvents(this.client, input);
	}

	/** Cancel a Run and cascade to all descendants. */
	async cancel(
		runId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<Run> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/runs/${encodeURIComponent(runId)}/cancel`,
			method: "POST",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as Run;
	}

	/** List runs for the authenticated user, with optional filters and cursor-based pagination. */
	async list(
		filter: RunListFilter = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<RunListResult> {
		const signal = this.client._composeSignal(opts.signal);
		const qs = new URLSearchParams();
		if (filter.rootsOnly !== undefined)
			qs.set("rootsOnly", String(filter.rootsOnly));
		if (filter.agentId) qs.set("agentId", filter.agentId);
		if (filter.status) qs.set("status", filter.status);
		if (filter.startedAfter) qs.set("startedAfter", filter.startedAfter);
		if (filter.startedBefore) qs.set("startedBefore", filter.startedBefore);
		if (filter.limit !== undefined) qs.set("limit", String(filter.limit));
		if (filter.cursor) qs.set("cursor", filter.cursor);

		const path = qs.toString() ? `/runs?${qs.toString()}` : "/runs";
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as RunListResult;
	}
}

export class TracesResource {
	constructor(private readonly client: AgntzClient) {}

	async list(
		filter: TraceFilter = {},
		opts: { signal?: AbortSignal } = {},
	): Promise<TracesListResult> {
		const signal = this.client._composeSignal(opts.signal);
		const qs = encodeTraceFilter(filter);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: qs ? `/traces?${qs}` : "/traces",
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as TracesListResult;
	}

	async get(
		traceId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<TraceDetail> {
		const signal = this.client._composeSignal(opts.signal);
		const res = await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/traces/${encodeURIComponent(traceId)}`,
			method: "GET",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
		return (await res.json()) as TraceDetail;
	}

	stream(
		traceId: string,
		opts: { signal?: AbortSignal } = {},
	): AsyncGenerator<TraceLiveEvent, void, void> {
		return streamTraceEvents(this.client, traceId, opts.signal);
	}

	async delete(
		traceId: string,
		opts: { signal?: AbortSignal } = {},
	): Promise<void> {
		const signal = this.client._composeSignal(opts.signal);
		await sendRequest({
			baseUrl: this.client._baseUrl,
			path: `/traces/${encodeURIComponent(traceId)}`,
			method: "DELETE",
			apiKey: this.client._apiKey,
			signal,
			fetchImpl: this.client._fetchImpl,
		});
	}
}

function encodeEvalRunFilter(filter: EvalRunListFilter): string {
	const params = new URLSearchParams();
	if (filter.agentId !== undefined) params.set("agentId", filter.agentId);
	if (filter.evalId !== undefined) params.set("evalId", filter.evalId);
	if (filter.datasetId !== undefined) params.set("datasetId", filter.datasetId);
	if (filter.status !== undefined) params.set("status", filter.status);
	if (filter.startedAfter !== undefined)
		params.set("startedAfter", filter.startedAfter);
	if (filter.startedBefore !== undefined)
		params.set("startedBefore", filter.startedBefore);
	if (filter.limit !== undefined) params.set("limit", String(filter.limit));
	if (filter.cursor !== undefined) params.set("cursor", filter.cursor);
	return params.toString();
}

function encodeEvalLatestScoreFilter(
	filter: EvalLatestScoreListFilter | EvalLatestScoreKey,
): string {
	const params = new URLSearchParams();
	if ("agentId" in filter && filter.agentId !== undefined)
		params.set("agentId", filter.agentId);
	if (filter.evalId !== undefined) params.set("evalId", filter.evalId);
	if (filter.datasetId !== undefined) params.set("datasetId", filter.datasetId);
	if (filter.resolvedAgentVersion !== undefined) {
		params.set("resolvedAgentVersion", filter.resolvedAgentVersion);
	}
	if ("status" in filter && filter.status !== undefined)
		params.set("status", filter.status);
	return params.toString();
}

function encodeTraceFilter(filter: TraceFilter): string {
	const params = new URLSearchParams();
	if (filter.agentId !== undefined) params.set("agentId", filter.agentId);
	if (filter.status !== undefined) params.set("status", filter.status);
	if (filter.startedAfter !== undefined)
		params.set("startedAfter", filter.startedAfter);
	if (filter.startedBefore !== undefined)
		params.set("startedBefore", filter.startedBefore);
	if (filter.limit !== undefined) params.set("limit", String(filter.limit));
	if (filter.cursor !== undefined) params.set("cursor", filter.cursor);
	return params.toString();
}

async function* streamTraceEvents(
	client: AgntzClient,
	traceId: string,
	signalIn?: AbortSignal,
): AsyncGenerator<TraceLiveEvent, void, void> {
	const signal = client._composeSignal(signalIn);
	const res = await sendRequest({
		baseUrl: client._baseUrl,
		path: `/traces/${encodeURIComponent(traceId)}/stream`,
		method: "GET",
		apiKey: client._apiKey,
		signal,
		accept: "text/event-stream",
		fetchImpl: client._fetchImpl,
	});
	if (!res.body) {
		throw new StreamError("Worker returned no stream body", {
			status: res.status,
		});
	}

	for await (const frame of parseSSE(res.body, signal)) {
		const ev = normalizeTraceLiveEvent(frame);
		if (!ev) continue;
		yield ev;
		// snapshot and trace-done both terminate the stream.
		if (ev.type === "snapshot" || ev.type === "trace-done") return;
	}
}

async function* streamRunEvents(
	client: AgntzClient,
	input: RunsStreamInput,
): AsyncGenerator<MultiplexedRunEvent, void, void> {
	const signal = client._composeSignal(input.signal);
	const path = `/runs/${encodeURIComponent(input.runId)}/stream${typeof input.since === "number" ? `?since=${input.since}` : ""}`;
	const res = await sendRequest({
		baseUrl: client._baseUrl,
		path,
		method: "GET",
		apiKey: client._apiKey,
		signal,
		accept: "text/event-stream",
		fetchImpl: client._fetchImpl,
	});
	if (!res.body) {
		throw new StreamError("Worker returned no stream body", {
			status: res.status,
		});
	}

	for await (const frame of parseSSE(res.body, signal)) {
		const ev = normalizeRunEvent(frame);
		if (!ev) continue;
		yield ev;
		if (
			ev.type === "snapshot" ||
			ev.type === "run-complete" ||
			ev.type === "run-error" ||
			ev.type === "run-cancelled"
		) {
			// For root terminal or snapshot, close the iterator cleanly.
			if (ev.type === "snapshot" || ev.runId === input.runId) {
				return;
			}
		}
	}
}

function isContentBlocks(value: unknown): value is ContentBlock[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(block) =>
				block !== null &&
				typeof block === "object" &&
				["text", "image", "audio"].includes(
					String((block as { type?: unknown }).type),
				),
		)
	);
}

async function artifactInputToBlob(
	input:
		| Blob
		| ArrayBuffer
		| Uint8Array
		| { path: string; mediaType?: string; filename?: string },
	mediaType?: string,
	filename?: string,
): Promise<{ blob: Blob; filename: string }> {
	if (input instanceof Blob) {
		const named = input as Blob & { name?: string };
		return {
			blob:
				mediaType && input.type !== mediaType
					? new Blob([input], { type: mediaType })
					: input,
			filename: filename ?? named.name ?? "artifact",
		};
	}
	if (input instanceof ArrayBuffer) {
		return {
			blob: new Blob([input], {
				type: mediaType ?? "application/octet-stream",
			}),
			filename: filename ?? "artifact",
		};
	}
	if (input instanceof Uint8Array) {
		const bytes = Uint8Array.from(input);
		return {
			blob: new Blob([bytes.buffer], {
				type: mediaType ?? "application/octet-stream",
			}),
			filename: filename ?? "artifact",
		};
	}
	const { readFile } = await import("node:fs/promises");
	const { basename } = await import("node:path");
	const bytes = await readFile(input.path);
	const blobBytes = Uint8Array.from(bytes);
	return {
		blob: new Blob([blobBytes.buffer], {
			type: mediaType ?? input.mediaType ?? "application/octet-stream",
		}),
		filename: filename ?? input.filename ?? basename(input.path),
	};
}

async function* streamAgentEvents(
	client: AgntzClient,
	input: RunInput,
): AsyncGenerator<StreamEvent, void, void> {
	const res = await client._runRequest(input, true);
	if (!res.body) {
		throw new StreamError("Worker returned no stream body", {
			status: res.status,
		});
	}
	const signal = client._resolveStreamSignal(input);
	let sawTerminal = false;
	let aborted = false;
	const onAbort = () => {
		aborted = true;
	};
	if (signal) {
		if (signal.aborted) aborted = true;
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	try {
		for await (const frame of parseSSE(res.body, signal)) {
			const event = normalizeEvent(frame);
			if (!event) continue;
			if (event.type === "complete" || event.type === "error") {
				sawTerminal = true;
			}
			yield event;
			if (sawTerminal) return;
		}
		if (!sawTerminal && !aborted) {
			throw new StreamError("Stream closed before completion", {
				code: "STREAM_TRUNCATED",
			});
		}
	} finally {
		if (signal) signal.removeEventListener("abort", onAbort);
	}
}
