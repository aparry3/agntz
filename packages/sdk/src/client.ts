import type {
	AgentImportInput,
	AgentImportResponse,
	AgentImportResult,
	AgentSummary,
	AgentDefinition as ClientAgentDefinition,
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
	MemoryImportInput,
	MemoryImportResponse,
	MemoryImportResult,
	MultiplexedRunEvent,
	Run,
	RunInput,
	RunListFilter,
	RunListResult,
	RunResult,
	RunsStartInput,
	RunsStreamInput,
	SessionImportInput,
	SessionImportResponse,
	SessionImportResult,
	StreamEvent,
	TraceDetail,
	TraceFilter,
	TraceLiveEvent,
	TracesListResult,
} from "@agntz/client";
import {
	InMemoryRunRegistry,
	SpanEmitter,
	createRunner,
	latestScoreFromEvalRun,
	manifestToAgentDefinition,
	runEval,
	summarizeEvalRun,
} from "@agntz/core";
import type { TokenCache } from "@agntz/core";
import type {
	EvalRun as CoreEvalRun,
	Run as CoreRun,
	StreamEvent as CoreStreamEvent,
	InvokeResult,
	Message,
	ModelProvider,
	Reply,
	ResourceProvider,
	RunRegistry,
	Runner,
	SessionSummary,
	ToolDefinition,
	UnifiedStore,
} from "@agntz/core";
import {
	type AgentManifest,
	type LLMAgentManifest,
	execute,
	parseManifest,
} from "@agntz/core/manifest";
import { createInitialState, renderTemplate } from "@agntz/core/manifest";
import type {
	CurateReport,
	ListOptions,
	MemoryEntry,
	Memrez,
	ReadOptions,
	ScanOptions,
	TopicSummary,
} from "@agntz/memrez";
import { MemoryStore } from "@agntz/stores/memory";
import { createExecutionContext } from "./bridge.js";
import { RunsBuffer, TracesBuffer, buildRunRecord } from "./buffers.js";
import { loadManifestsFromDir } from "./loader.js";
import { createTraceAggregator } from "./trace-aggregator.js";

export interface AgntzLocalOptions {
	agents: string;
	/**
	 * Local tools made available to agents. Each tool is self-describing —
	 * name, description, Zod input schema, and an `execute` function. Use the
	 * `tool()` helper from this package for ergonomic type inference, or pass
	 * raw `ToolDefinition` objects from `@agntz/core` for advanced cases.
	 *
	 * Names referenced from agent manifests but missing from this array raise
	 * an error at load time.
	 */
	tools?: ToolDefinition[];
	envProvider?: (name: string) => string | undefined;
	modelProvider?: ModelProvider;
	resources?: Record<string, ResourceProvider>;
	evals?: EvalDefinition[];
	datasets?: EvalDataset[];
	runsCapacity?: number;
	tracesCapacity?: number;
	onEvent?: (event: CoreStreamEvent) => void;
	store?: UnifiedStore;
	/**
	 * Cache backend for HTTP tool auth tokens (oauth2_client_credentials /
	 * token_exchange). Defaults to an in-memory MapTokenCache. Swap in a
	 * persistent backend for hosted deployments to avoid token churn on
	 * cold starts.
	 */
	tokenCache?: TokenCache;
	/**
	 * Memrez instance for memory admin (view/delete). Held directly by the host
	 * — a ResourceProvider deliberately exposes only tools/getContext/purgeScope,
	 * not list/delete. When provided and `resources.memory` is unset, it is also
	 * auto-wired as the "memory" resource so agents can read/write memory.
	 */
	memrez?: Memrez;
}

export interface LocalClient {
	readonly agents: LocalAgentsResource;
	readonly datasets: LocalDatasetsResource;
	readonly evals: LocalEvalsResource;
	readonly runs: LocalRunsResource;
	readonly traces: LocalTracesResource;
	readonly sessions: LocalSessionsResource;
	/** Present only when `memrez` was supplied to `agntz()`. */
	readonly memory?: LocalMemoryResource;
	readonly manifests: ReadonlyMap<string, AgentManifest>;
	readonly _runner: Runner;
}

export interface LocalAgentsResource {
	run(input: RunInput): Promise<RunResult>;
	stream(input: RunInput): AsyncGenerator<StreamEvent, void, void>;
	list(): Promise<AgentSummary[]>;
	get(agentId: string): Promise<ClientAgentDefinition>;
	import(input: AgentImportInput): Promise<AgentImportResponse>;
}

export interface LocalDatasetsResource {
	list(filter?: EvalDatasetListFilter): Promise<EvalDataset[]>;
	create(dataset: EvalDataset): Promise<EvalDataset>;
	get(id: string): Promise<EvalDataset | null>;
	update(id: string, patch: Partial<EvalDataset>): Promise<EvalDataset>;
	delete(id: string): Promise<void>;
}

export interface LocalEvalsResource {
	list(filter?: EvalListFilter): Promise<EvalDefinition[]>;
	create(definition: EvalDefinition): Promise<EvalDefinition>;
	get(id: string): Promise<EvalDefinition | null>;
	update(id: string, patch: Partial<EvalDefinition>): Promise<EvalDefinition>;
	delete(id: string): Promise<void>;
	run(input: EvalRunInput): Promise<EvalRun>;
	getRun(id: string): Promise<EvalRun | null>;
	listRuns(filter?: EvalRunListFilter): Promise<EvalRunListResult>;
	cancelRun(id: string): Promise<EvalRun | null>;
	getLatestScore(key: EvalLatestScoreKey): Promise<EvalLatestScore | null>;
	listLatestScores(
		filter?: EvalLatestScoreListFilter,
	): Promise<EvalLatestScore[]>;
}

export interface LocalRunsResource {
	list(filter?: RunListFilter): Promise<RunListResult>;
	get(id: string): Promise<Run>;
	/** Start a run and return its handle immediately (status: "running"). */
	start(input: RunsStartInput): Promise<Run>;
	/** Multiplexed live feed for a run's subtree (mirrors the hosted SSE feed). */
	stream(
		input: RunsStreamInput,
	): AsyncGenerator<MultiplexedRunEvent, void, void>;
	/** Cancel a run and cascade to all descendants. */
	cancel(runId: string): Promise<Run>;
}

export interface LocalTracesResource {
	list(filter?: TraceFilter): Promise<TracesListResult>;
	get(traceId: string): Promise<TraceDetail | null>;
	/** Live feed for a trace. Embedded runs complete synchronously, so this
	 *  replays the finished trace as a single `snapshot` event, then closes. */
	stream(traceId: string): AsyncGenerator<TraceLiveEvent, void, void>;
	delete(traceId: string): Promise<void>;
}

export interface LocalSessionsResource {
	list(agentId?: string): Promise<SessionSummary[]>;
	get(id: string): Promise<{ sessionId: string; messages: Message[] }>;
	import(input: SessionImportInput): Promise<SessionImportResponse>;
	/** Erases the session and everything linked to it (the store's teardown). */
	delete(id: string): Promise<void>;
}

export interface LocalMemoryResource {
	import(input: MemoryImportInput): Promise<MemoryImportResponse>;
	scan(
		grants: string[],
		opts?: ScanOptions,
	): Promise<{ grants: string[]; topics: TopicSummary[] }>;
	read(
		grants: string[],
		topic: string | string[],
		opts?: ReadOptions,
	): Promise<MemoryEntry[]>;
	list(grants: string[], opts?: ListOptions): Promise<MemoryEntry[]>;
	deleteEntry(
		grants: string[],
		id: string,
	): Promise<{ deleted: boolean; id: string }>;
	deleteScope(
		grants: string[],
		prefix: string,
		opts?: { recursive?: boolean },
	): Promise<{
		deleted: number;
		topicMeta: number;
		scope: string;
		recursive: boolean;
	}>;
	curate(
		grants: string[],
		opts?: { topics?: string[]; signal?: AbortSignal },
	): Promise<CurateReport>;
	correct(
		grants: string[],
		id: string,
		content: string,
	): Promise<{ entry: MemoryEntry }>;
}

export async function agntz(opts: AgntzLocalOptions): Promise<LocalClient> {
	// Mutable so `agents.import` can register manifests at runtime. The public
	// `LocalClient.manifests` exposes it as a ReadonlyMap.
	const manifests = new Map(await loadManifestsFromDir(opts.agents));
	const toolDefs: ToolDefinition[] = opts.tools ?? [];
	const localToolNames = new Set(toolDefs.map((t) => t.name));

	const envProvider = opts.envProvider ?? ((name: string) => process.env[name]);
	const store = opts.store ?? new MemoryStore();

	// Auto-wire the memrez handle as the "memory" resource unless the caller
	// already supplied one, so a single `memrez` option powers both the agent
	// tools and the admin surface (client.memory).
	const resources =
		opts.memrez && !opts.resources?.memory
			? { ...opts.resources, memory: opts.memrez.provider() }
			: opts.resources;

	const runner = createRunner({
		tools: toolDefs,
		envProvider,
		modelProvider: opts.modelProvider,
		resources,
		store,
		tokenCache: opts.tokenCache,
	});

	for (const dataset of opts.datasets ?? []) {
		await store.putDataset(dataset);
	}
	for (const definition of opts.evals ?? []) {
		await store.putEval(definition);
	}

	// Register LLM agents up-front so spawn / agent-as-tool refs resolve. Non-
	// LLM kinds are dispatched through the manifest executor at run time and
	// don't need a pre-registration step.
	for (const manifest of manifests.values()) {
		if (manifest.kind === "llm") {
			const def = manifestToAgentDefinition(manifest, {
				localToolNames,
				rejectSkills: true,
			});
			runner.registerAgent(def);
		}
	}

	// Build local tool name → ToolDefinition map for pipeline tool steps.
	const localToolsMap = new Map<string, ToolDefinition>(
		toolDefs.map((t) => [t.name, t]),
	);

	return new LocalClientImpl(
		runner,
		manifests,
		localToolsMap,
		localToolNames,
		store,
		opts,
	);
}

class LocalClientImpl implements LocalClient {
	readonly agents: LocalAgentsResource;
	readonly datasets: LocalDatasetsResource;
	readonly evals: LocalEvalsResource;
	readonly runs: LocalRunsResource;
	readonly traces: LocalTracesResource;
	readonly sessions: LocalSessionsResource;
	readonly memory?: LocalMemoryResource;
	constructor(
		readonly _runner: Runner,
		readonly manifests: Map<string, AgentManifest>,
		localToolsMap: Map<string, ToolDefinition>,
		localToolNames: Set<string>,
		store: UnifiedStore,
		opts: AgntzLocalOptions,
	) {
		const runsBuffer = new RunsBuffer({ capacity: opts.runsCapacity });
		const tracesBuffer = new TracesBuffer({ capacity: opts.tracesCapacity });
		const traceSink = createTraceAggregator(tracesBuffer);

		// One in-process Run registry — the same primitive the worker wires
		// process-wide. Every Run started via `runs.start` is first-class: its
		// lifecycle + multiplexed events flow through here, and `persistRun`
		// mirrors each transition into the buffer so `runs.list/get` see it.
		const runRegistry = new InMemoryRunRegistry({
			persistRun: (run) => {
				// Buffer only top-level Runs. Inner LLM steps are child Runs (temp
				// agent ids) that live in the registry for the subtree feed
				// (`runs.stream`) but would be noise in `runs.list`/`runs.get`.
				if (run.rootId === run.id) runsBuffer.upsert(run as unknown as Run);
			},
		});

		// Shared run executor — one execution path for every invocation type.
		// `agents.run` awaits it; `runs.start` fires it; `agents.stream` streams
		// natively but wires the same registry. Inner LLM steps attach to the root
		// Run as children, so spawn_agent + the multiplexed feed work everywhere.
		const runManifest: RunExecutorFn = (input, root, sessionId, signal) =>
			runManifestForRegistry({
				runner: _runner,
				manifests,
				localToolNames,
				localTools: localToolsMap,
				traceSink,
				runRegistry,
				input,
				root,
				sessionId,
				signal,
			});

		this.agents = new AgentsResourceImpl(
			_runner,
			manifests,
			localToolsMap,
			localToolNames,
			runsBuffer,
			traceSink,
			opts.onEvent,
			runRegistry,
			runManifest,
		);
		this.datasets = new DatasetsResourceImpl(store);
		this.evals = new EvalsResourceImpl(_runner, store);
		this.runs = new RunsResourceImpl(runRegistry, runsBuffer, runManifest);
		this.traces = new TracesResourceImpl(tracesBuffer);
		this.sessions = new SessionsResourceImpl(_runner);
		// Memory admin is only available when a memrez handle was supplied.
		this.memory = opts.memrez ? new MemoryResourceImpl(opts.memrez) : undefined;
	}
}

class SessionsResourceImpl implements LocalSessionsResource {
	constructor(private readonly runner: Runner) {}

	list(agentId?: string): Promise<SessionSummary[]> {
		return this.runner.sessions.listSessions(agentId);
	}

	async get(id: string): Promise<{ sessionId: string; messages: Message[] }> {
		return {
			sessionId: id,
			messages: await this.runner.sessions.getMessages(id),
		};
	}

	async import(input: SessionImportInput): Promise<SessionImportResponse> {
		const results: SessionImportResult[] = [];
		for (const snapshot of input.sessions) {
			const existing = await this.runner.sessions
				.getMessages(snapshot.sessionId)
				.catch(() => [] as Message[]);
			const exists = existing.length > 0;
			if (exists && input.onConflict === "fail") {
				throw new Error(`Session already exists: ${snapshot.sessionId}`);
			}
			if (exists && input.onConflict === "skip") {
				results.push({
					sessionId: snapshot.sessionId,
					agentId: snapshot.agentId,
					action: "skip",
					messageCount: 0,
				});
				continue;
			}
			if (!input.dryRun) {
				await this.runner.sessions.getOrCreateSession(snapshot.sessionId);
				await this.runner.sessions.append(
					snapshot.sessionId,
					snapshot.messages as unknown as Message[],
				);
			}
			results.push({
				sessionId: snapshot.sessionId,
				agentId: snapshot.agentId,
				action: exists ? "update" : "create",
				messageCount: snapshot.messages.length,
			});
		}
		return {
			dryRun: input.dryRun ?? false,
			results,
			counts: countActions(results),
		};
	}

	delete(id: string): Promise<void> {
		return this.runner.sessions.deleteSession(id);
	}
}

class MemoryResourceImpl implements LocalMemoryResource {
	constructor(private readonly memrez: Memrez) {}

	async import(input: MemoryImportInput): Promise<MemoryImportResponse> {
		// Mirror the worker's POST /memory/import: write RAW pre-formed entries
		// straight to the store (NOT memrez.write, which re-tags). The worker's
		// per-tenant namespace-root bounding is a hosted-only concern — the
		// embedded SDK has a single trusted operator, so it's omitted here.
		const results: MemoryImportResult[] = [];
		for (const entry of input.entries) {
			const existing = await this.memrez.store.getEntry(entry.id);
			if (!input.dryRun) {
				await this.memrez.store.putEntry(entry as unknown as MemoryEntry);
			}
			results.push({
				id: entry.id,
				scope: entry.scope,
				action: existing ? "update" : "create",
				status: entry.status,
			});
		}
		return {
			dryRun: input.dryRun ?? false,
			results,
			counts: countActions(results),
		};
	}

	scan(grants: string[], opts?: ScanOptions) {
		return this.memrez.scan(grants, opts);
	}

	read(grants: string[], topic: string | string[], opts?: ReadOptions) {
		return this.memrez.read(grants, topic, opts);
	}

	list(grants: string[], opts?: ListOptions) {
		return this.memrez.list(grants, opts);
	}

	deleteEntry(grants: string[], id: string) {
		return this.memrez.deleteEntry(grants, id);
	}

	deleteScope(
		grants: string[],
		prefix: string,
		opts?: { recursive?: boolean },
	) {
		return this.memrez.deleteScope(grants, prefix, opts);
	}

	curate(grants: string[], opts?: { topics?: string[]; signal?: AbortSignal }) {
		return this.memrez.curate(
			grants,
			opts?.topics ? { topics: opts.topics } : undefined,
		);
	}

	correct(grants: string[], id: string, content: string) {
		return this.memrez.correct(grants, id, content);
	}
}

class DatasetsResourceImpl implements LocalDatasetsResource {
	constructor(private readonly store: UnifiedStore) {}

	async list(filter: EvalDatasetListFilter = {}): Promise<EvalDataset[]> {
		return (await this.store.listDatasets(
			filter as never,
		)) as unknown as EvalDataset[];
	}

	async create(dataset: EvalDataset): Promise<EvalDataset> {
		await this.store.putDataset(dataset as never);
		return (
			((await this.store.getDataset(
				dataset.id,
			)) as unknown as EvalDataset | null) ?? dataset
		);
	}

	async get(id: string): Promise<EvalDataset | null> {
		return (await this.store.getDataset(id)) as unknown as EvalDataset | null;
	}

	async update(id: string, patch: Partial<EvalDataset>): Promise<EvalDataset> {
		const existing = (await this.store.getDataset(
			id,
		)) as unknown as EvalDataset | null;
		if (!existing) throw new Error(`Dataset not found: ${id}`);
		const next = { ...existing, ...patch, id };
		await this.store.putDataset(next as never);
		return (
			((await this.store.getDataset(id)) as unknown as EvalDataset | null) ??
			next
		);
	}

	async delete(id: string): Promise<void> {
		await this.store.deleteDataset(id);
	}
}

class EvalsResourceImpl implements LocalEvalsResource {
	constructor(
		private readonly runner: Runner,
		private readonly store: UnifiedStore,
	) {}

	async list(filter: EvalListFilter = {}): Promise<EvalDefinition[]> {
		return this.store.listEvals(filter);
	}

	async create(definition: EvalDefinition): Promise<EvalDefinition> {
		await this.store.putEval(definition);
		return (await this.store.getEval(definition.id)) ?? definition;
	}

	async get(id: string): Promise<EvalDefinition | null> {
		return this.store.getEval(id);
	}

	async update(
		id: string,
		patch: Partial<EvalDefinition>,
	): Promise<EvalDefinition> {
		const existing = await this.store.getEval(id);
		if (!existing) throw new Error(`Eval not found: ${id}`);
		const next = { ...existing, ...patch, id };
		await this.store.putEval(next);
		return (await this.store.getEval(id)) ?? next;
	}

	async delete(id: string): Promise<void> {
		await this.store.deleteEval(id);
	}

	async run(input: EvalRunInput): Promise<EvalRun> {
		return (await runEval(
			this.runner,
			this.store,
			input as never,
		)) as unknown as EvalRun;
	}

	async getRun(id: string): Promise<EvalRun | null> {
		return (await this.store.getEvalRun(id)) as unknown as EvalRun | null;
	}

	async listRuns(filter: EvalRunListFilter = {}): Promise<EvalRunListResult> {
		return (await this.store.listEvalRuns(
			filter as never,
		)) as unknown as EvalRunListResult;
	}

	async cancelRun(id: string): Promise<EvalRun | null> {
		const run = (await this.store.getEvalRun(id)) as unknown as EvalRun | null;
		if (!run) return null;
		if (run.status !== "running" && run.status !== "pending") return run;
		const next: EvalRun = {
			...run,
			status: "cancelled",
			endedAt: run.endedAt ?? new Date().toISOString(),
			caseResults: [
				...run.caseResults,
				...run.snapshots.dataset.items
					.filter(
						(item) =>
							!run.caseResults.some((result) => result.itemId === item.id),
					)
					.map((item) => ({
						itemId: item.id,
						status: "cancelled" as const,
						input: item.input,
						criteria: {},
						score: 0,
						passed: false,
						error: "Eval run cancelled.",
					})),
			],
		};
		const coreRun = next as unknown as CoreEvalRun;
		next.summary = summarizeEvalRun(
			coreRun.snapshots.eval,
			coreRun.caseResults,
		);
		await this.store.putEvalRun(coreRun);
		await this.store.putEvalLatestScore(latestScoreFromEvalRun(coreRun));
		return next;
	}

	async getLatestScore(
		key: EvalLatestScoreKey,
	): Promise<EvalLatestScore | null> {
		return (await this.store.getEvalLatestScore(
			key as never,
		)) as unknown as EvalLatestScore | null;
	}

	async listLatestScores(
		filter: EvalLatestScoreListFilter = {},
	): Promise<EvalLatestScore[]> {
		return (await this.store.listEvalLatestScores(
			filter as never,
		)) as unknown as EvalLatestScore[];
	}
}

class AgentsResourceImpl implements LocalAgentsResource {
	constructor(
		private readonly runner: Runner,
		private readonly manifests: Map<string, AgentManifest>,
		private readonly localTools: Map<string, ToolDefinition>,
		private readonly localToolNames: Set<string>,
		private readonly runsBuffer: RunsBuffer,
		private readonly traceSink: (event: TraceLiveEvent) => void,
		private readonly onEvent: ((event: CoreStreamEvent) => void) | undefined,
		private readonly registry: RunRegistry,
		private readonly runManifest: RunExecutorFn,
	) {}

	async list(): Promise<AgentSummary[]> {
		return [...this.manifests.values()].map((m) => ({
			id: m.id,
			name: m.name ?? m.id,
			...(m.description ? { description: m.description } : {}),
		}));
	}

	async get(agentId: string): Promise<ClientAgentDefinition> {
		const manifest = this.manifests.get(agentId);
		if (!manifest) {
			throw new Error(`Agent "${agentId}" not loaded from agents directory`);
		}
		return manifestToClientAgentDefinition(manifest);
	}

	async import(input: AgentImportInput): Promise<AgentImportResponse> {
		const results: AgentImportResult[] = [];
		for (const item of input.agents) {
			const manifest = parseManifest(item.manifest);
			const exists = this.manifests.has(manifest.id);
			if (exists && input.onConflict === "fail") {
				throw new Error(`Agent already exists: ${manifest.id}`);
			}
			if (exists && input.onConflict === "skip") {
				results.push({
					id: manifest.id,
					sourcePath: item.sourcePath,
					action: "skip",
				});
				continue;
			}
			if (!input.dryRun) {
				this.manifests.set(manifest.id, manifest);
				if (manifest.kind === "llm") {
					this.runner.registerAgent(
						manifestToAgentDefinition(manifest, {
							localToolNames: this.localToolNames,
							rejectSkills: true,
						}),
					);
				}
			}
			results.push({
				id: manifest.id,
				sourcePath: item.sourcePath,
				action: exists
					? input.onConflict === "version"
						? "version"
						: "update"
					: "create",
			});
		}
		return {
			dryRun: input.dryRun ?? false,
			results,
			counts: countActions(results),
		};
	}

	async run(input: RunInput): Promise<RunResult> {
		const inputAsString = inputToString(input.input);

		// Pre-flight: a missing manifest surfaces as a failed run + throw — the
		// same contract as before the registry rerouting.
		try {
			this.requireManifest(input.agentId);
		} catch (e) {
			const now = Date.now();
			this.runsBuffer.record(
				buildRunRecord({
					runId: generateRunId(),
					agentId: input.agentId,
					inputAsString,
					status: "failed",
					error: e instanceof Error ? e.message : String(e),
					startedAt: now,
					endedAt: now,
				}),
			);
			throw e;
		}

		// Same execution path as `runs.start`: create a first-class root Run and
		// run the shared executor (inner LLM steps attach as children, so
		// spawn_agent works) — but await the terminal state and return a
		// `RunResult`. `RunResult.output` stays the RAW object from execute(); the
		// Run record stores the stringified form.
		const sessionId = input.sessionId ?? generateSessionId();
		const root = this.registry.create({
			agentId: input.agentId,
			input: inputAsString,
			sessionId,
		});
		// Bridge the caller's AbortSignal onto the Run's controller.
		if (input.signal) {
			if (input.signal.aborted) this.registry.cancel(root.id, "aborted");
			else
				input.signal.addEventListener(
					"abort",
					() => this.registry.cancel(root.id, "aborted"),
					{ once: true },
				);
		}

		let captured:
			| { invokeResult: InvokeResult; output: unknown; replies: Reply[] }
			| undefined;
		let execErr: unknown;
		this.registry.start(root, async (signal) => {
			try {
				captured = await this.runManifest(
					{
						agentId: input.agentId,
						...(input.input !== undefined ? { input: input.input } : {}),
						sessionId,
						...(input.context ? { context: input.context } : {}),
					},
					root,
					sessionId,
					signal,
				);
				return captured.invokeResult;
			} catch (e) {
				execErr = e;
				throw e;
			}
		});
		await this.registry.waitForTerminal(root.id);
		if (execErr) throw execErr;
		if (!captured) throw new Error(`Run "${root.id}" produced no result`);
		return invokeResultToRunResult(captured.invokeResult, captured.output);
	}

	async *stream(input: RunInput): AsyncGenerator<StreamEvent, void, void> {
		const manifest = this.requireManifest(input.agentId);
		const inputAsString = inputToString(input.input);
		const spanEmitter = new SpanEmitter({ traceSink: this.traceSink });

		// Non-LLM kinds don't natively stream — run to completion (registry-backed
		// via `this.run`, which records the Run) and collapse to one `complete`.
		if (manifest.kind !== "llm") {
			if (input.sessionId) {
				yield {
					type: "start",
					agentId: input.agentId,
					kind: manifest.kind,
					sessionId: input.sessionId,
				};
			}
			try {
				const result = await this.run(input);
				yield {
					type: "complete",
					output: result.output,
					state: result.state,
					sessionId: result.sessionId,
				};
			} catch (e) {
				yield {
					type: "error",
					error: e instanceof Error ? e.message : String(e),
				};
				throw e;
			}
			return;
		}

		// LLM streaming path — render the template, register a temp agent, and
		// stream natively for real token deltas, WIRED to the registry so the Run
		// is first-class (listable/cancellable) and spawn_agent is available. The
		// Run is attributed to the REAL agent id; the temp id only carries the
		// rendered definition. `persistRun` records the Run on each transition.
		const sessionId = input.sessionId ?? generateSessionId();
		const state = createInitialState(input.input ?? "", manifest.inputSchema);
		const renderedInstruction = renderTemplate(manifest.instruction, state);
		const tempId = `__stream_${manifest.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const def = manifestToAgentDefinition(manifest, {
			localToolNames: this.localToolNames,
			rejectSkills: true,
			systemPrompt: renderedInstruction,
		});
		def.id = tempId;
		def.userPromptTemplate = undefined;
		this.runner.registerAgent(def);

		const root = this.registry.create({
			agentId: input.agentId,
			input: inputAsString,
			sessionId,
		});

		if (input.sessionId) {
			yield {
				type: "start",
				agentId: input.agentId,
				kind: "llm",
				sessionId: input.sessionId,
			};
		}
		try {
			const userInput =
				manifest.prompt != null
					? renderTemplate(manifest.prompt, state)
					: state.userQuery != null
						? String(state.userQuery)
						: "";
			const iter = this.runner.stream(tempId, userInput, {
				sessionId,
				context: input.context,
				signal: input.signal,
				spanEmitter,
				runRegistry: this.registry,
				runId: root.id,
			});
			for await (const event of iter) {
				this.onEvent?.(event);
				const mapped = mapCoreStreamEvent(event);
				if (mapped) yield mapped;
			}
		} catch (e) {
			yield {
				type: "error",
				error: e instanceof Error ? e.message : String(e),
			};
			throw e;
		} finally {
			this.runner.deregisterAgent(tempId);
		}
	}

	private requireManifest(agentId: string): AgentManifest {
		const manifest = this.manifests.get(agentId);
		if (!manifest) {
			throw new Error(`Agent "${agentId}" not loaded from agents directory`);
		}
		return manifest;
	}
}

type RunExecutorFn = (
	input: RunsStartInput,
	root: CoreRun,
	sessionId: string,
	signal: AbortSignal,
) => Promise<{ invokeResult: InvokeResult; output: unknown; replies: Reply[] }>;

class RunsResourceImpl implements LocalRunsResource {
	constructor(
		private readonly registry: RunRegistry,
		private readonly buffer: RunsBuffer,
		private readonly runManifest: RunExecutorFn,
	) {}

	async list(filter: RunListFilter = {}): Promise<RunListResult> {
		return this.buffer.list(filter);
	}

	async get(id: string): Promise<Run> {
		const run =
			(this.registry.get(id) as unknown as Run | undefined) ??
			this.buffer.get(id);
		if (!run) throw new Error(`Run not found: ${id}`);
		return run;
	}

	async start(input: RunsStartInput): Promise<Run> {
		const sessionId = input.sessionId ?? generateSessionId();
		const root = this.registry.create({
			agentId: input.agentId,
			input: inputToString(input.input),
			sessionId,
		});
		// Fire-and-forget: start() flips the Run to "running" synchronously and
		// runs the executor on a microtask, so we return the running handle now.
		this.registry.start(root, async (signal) => {
			const { invokeResult } = await this.runManifest(
				input,
				root,
				sessionId,
				signal,
			);
			return invokeResult;
		});
		return (this.registry.get(root.id) ?? root) as unknown as Run;
	}

	async *stream(
		input: RunsStreamInput,
	): AsyncGenerator<MultiplexedRunEvent, void, void> {
		const live = this.registry.get(input.runId);
		if (!live) {
			// Evicted or unknown — fall back to a one-shot snapshot if we still
			// have the terminal Run buffered (mirrors the hosted SSE fallback).
			const snapshot = this.buffer.get(input.runId);
			if (snapshot) {
				yield { type: "snapshot", run: snapshot } as MultiplexedRunEvent;
			}
			return;
		}
		for await (const event of this.registry.subscribe(
			live.rootId,
			input.since,
		)) {
			yield event as unknown as MultiplexedRunEvent;
		}
	}

	async cancel(runId: string): Promise<Run> {
		this.registry.cancel(runId, "cancelled by user");
		return this.get(runId);
	}
}

class TracesResourceImpl implements LocalTracesResource {
	constructor(private readonly buffer: TracesBuffer) {}
	async list(filter: TraceFilter = {}): Promise<TracesListResult> {
		return this.buffer.list(filter);
	}
	async get(traceId: string): Promise<TraceDetail | null> {
		return this.buffer.get(traceId);
	}
	async *stream(traceId: string): AsyncGenerator<TraceLiveEvent, void, void> {
		// Embedded runs complete synchronously, so by the time a trace is
		// streamable it is already finished — replay it as one `snapshot`.
		const detail = this.buffer.get(traceId);
		if (detail) {
			yield { type: "snapshot", summary: detail.summary, spans: detail.spans };
		}
	}
	async delete(traceId: string): Promise<void> {
		this.buffer.delete(traceId);
	}
}

function generateRunId(): string {
	return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateSessionId(): string {
	return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function inputToString(input: RunInput["input"]): string {
	if (input == null) return "";
	if (typeof input === "string") return input;
	return JSON.stringify(input);
}

/**
 * Executor body shared by `runs.start`. Mirrors the hosted worker's POST /runs:
 * build an ExecutionContext wired to the registry (so inner LLM steps attach to
 * the root as CHILD runs), execute the manifest, then synthesize the root's
 * `InvokeResult` (the registry emits it as the `run-complete` event).
 */
async function runManifestForRegistry(args: {
	runner: Runner;
	manifests: ReadonlyMap<string, AgentManifest>;
	localToolNames: Set<string>;
	localTools: Map<string, ToolDefinition>;
	traceSink: (event: TraceLiveEvent) => void;
	runRegistry: RunRegistry;
	input: RunsStartInput;
	root: CoreRun;
	sessionId: string;
	signal: AbortSignal;
}): Promise<{ invokeResult: InvokeResult; output: unknown; replies: Reply[] }> {
	const manifest = args.manifests.get(args.input.agentId);
	if (!manifest) {
		throw new Error(
			`Agent "${args.input.agentId}" not loaded from agents directory`,
		);
	}
	const replies: Reply[] = [];
	const spanEmitter = new SpanEmitter({ traceSink: args.traceSink });
	const ctx = createExecutionContext(
		args.runner,
		args.manifests,
		args.localToolNames,
		{
			spanEmitter,
			sessionId: args.sessionId,
			context: args.input.context,
			signal: args.signal,
			localTools: args.localTools,
			replyCollector: replies,
			runRegistry: args.runRegistry,
			parentRunId: args.root.id,
		},
	);
	const result = await execute(manifest, args.input.input ?? "", ctx);
	if (args.signal.aborted) {
		throw args.signal.reason instanceof Error
			? args.signal.reason
			: new Error(String(args.signal.reason ?? "aborted"));
	}
	const outputStr =
		typeof result.output === "string"
			? result.output
			: JSON.stringify(result.output);
	const invokeResult: InvokeResult = {
		output: outputStr,
		invocationId: args.root.id,
		sessionId: args.sessionId,
		toolCalls: [],
		usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		duration: Date.now() - args.root.startedAt,
		model:
			manifest.kind === "llm"
				? `${manifest.model.provider}/${manifest.model.name}`
				: "manifest",
		...(replies.length > 0 ? { replies } : {}),
	};
	return { invokeResult, output: result.output, replies };
}

/** Build a client-shaped `AgentDefinition` from a parsed manifest. */
function manifestToClientAgentDefinition(
	manifest: AgentManifest,
): ClientAgentDefinition {
	const base: ClientAgentDefinition = {
		id: manifest.id,
		name: manifest.name ?? manifest.id,
		...(manifest.description ? { description: manifest.description } : {}),
	};
	if (manifest.kind !== "llm") return base;
	const llm = manifest as LLMAgentManifest;
	return {
		...base,
		systemPrompt: llm.instruction,
		model: {
			provider: llm.model.provider,
			name: llm.model.name,
			...(llm.model.temperature !== undefined
				? { temperature: llm.model.temperature }
				: {}),
			...(llm.model.maxTokens !== undefined
				? { maxTokens: llm.model.maxTokens }
				: {}),
			...(llm.model.topP !== undefined ? { topP: llm.model.topP } : {}),
		},
	};
}

/** Tally `action` values for an import response's `counts` field. */
function countActions(
	results: Array<{ action: string }>,
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const r of results) counts[r.action] = (counts[r.action] ?? 0) + 1;
	return counts;
}

function invokeResultToRunResult(
	result: InvokeResult,
	output: unknown,
): RunResult {
	return {
		output,
		state: {
			invocationId: result.invocationId,
			usage: result.usage,
			duration: result.duration,
			model: result.model,
			toolCalls: result.toolCalls,
		},
		sessionId: result.sessionId,
		replies: result.replies,
	};
}

function mapCoreStreamEvent(event: CoreStreamEvent): StreamEvent | null {
	switch (event.type) {
		case "done":
			return {
				type: "complete",
				output: event.result.output,
				state: {
					invocationId: event.result.invocationId,
					usage: event.result.usage,
					duration: event.result.duration,
					model: event.result.model,
					toolCalls: event.result.toolCalls,
				},
				sessionId: event.result.sessionId,
			};
		case "reply":
			return {
				type: "reply",
				text: event.text,
				ts: event.ts,
				sessionId: event.sessionId,
				runId: event.runId,
			};
		default:
			return null;
	}
}
