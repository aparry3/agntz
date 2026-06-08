import type {
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
	Run,
	RunInput,
	RunListFilter,
	RunListResult,
	RunResult,
	StreamEvent,
	TraceDetail,
	TraceFilter,
	TracesListResult,
} from "@agntz/client";
import {
	MemoryStore,
	SpanEmitter,
	createRunner,
	latestScoreFromEvalRun,
	runEval,
	summarizeEvalRun,
} from "@agntz/core";
import type { TokenCache } from "@agntz/core";
import type {
	EvalRun as CoreEvalRun,
	StreamEvent as CoreStreamEvent,
	InvokeResult,
	ModelProvider,
	Reply,
	ResourceProvider,
	Runner,
	ToolDefinition,
	UnifiedStore,
} from "@agntz/core";
import { type AgentManifest, execute } from "@agntz/manifest";
import { createInitialState, renderTemplate } from "@agntz/manifest";
import { createExecutionContext } from "./bridge.js";
import { RunsBuffer, TracesBuffer, buildRunRecord } from "./buffers.js";
import { loadManifestsFromDir } from "./loader.js";
import { manifestToAgentDefinition } from "./manifest-to-agent.js";
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
}

export interface LocalClient {
	readonly agents: LocalAgentsResource;
	readonly datasets: LocalDatasetsResource;
	readonly evals: LocalEvalsResource;
	readonly runs: LocalRunsResource;
	readonly traces: LocalTracesResource;
	readonly manifests: ReadonlyMap<string, AgentManifest>;
	readonly _runner: Runner;
}

export interface LocalAgentsResource {
	run(input: RunInput): Promise<RunResult>;
	stream(input: RunInput): AsyncGenerator<StreamEvent, void, void>;
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
	get(id: string): Promise<Run | null>;
}

export interface LocalTracesResource {
	list(filter?: TraceFilter): Promise<TracesListResult>;
	get(traceId: string): Promise<TraceDetail | null>;
}

export async function agntz(opts: AgntzLocalOptions): Promise<LocalClient> {
	const manifests = await loadManifestsFromDir(opts.agents);
	const toolDefs: ToolDefinition[] = opts.tools ?? [];
	const localToolNames = new Set(toolDefs.map((t) => t.name));

	const envProvider = opts.envProvider ?? ((name: string) => process.env[name]);
	const store = opts.store ?? new MemoryStore();

	const runner = createRunner({
		tools: toolDefs,
		envProvider,
		modelProvider: opts.modelProvider,
		resources: opts.resources,
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
			const def = manifestToAgentDefinition(manifest, localToolNames);
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
	constructor(
		readonly _runner: Runner,
		readonly manifests: ReadonlyMap<string, AgentManifest>,
		localToolsMap: Map<string, ToolDefinition>,
		localToolNames: Set<string>,
		store: UnifiedStore,
		opts: AgntzLocalOptions,
	) {
		const runsBuffer = new RunsBuffer({ capacity: opts.runsCapacity });
		const tracesBuffer = new TracesBuffer({ capacity: opts.tracesCapacity });
		const traceSink = createTraceAggregator(tracesBuffer);

		this.agents = new AgentsResourceImpl(
			_runner,
			manifests,
			localToolsMap,
			localToolNames,
			runsBuffer,
			traceSink,
			opts.onEvent,
		);
		this.datasets = new DatasetsResourceImpl(store);
		this.evals = new EvalsResourceImpl(_runner, store);
		this.runs = new RunsResourceImpl(runsBuffer);
		this.traces = new TracesResourceImpl(tracesBuffer);
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
		private readonly manifests: ReadonlyMap<string, AgentManifest>,
		private readonly localTools: Map<string, ToolDefinition>,
		private readonly localToolNames: Set<string>,
		private readonly runsBuffer: RunsBuffer,
		private readonly traceSink: (
			event: import("@agntz/client").TraceLiveEvent,
		) => void,
		private readonly onEvent: ((event: CoreStreamEvent) => void) | undefined,
	) {}

	async run(input: RunInput): Promise<RunResult> {
		const runId = generateRunId();
		const startedAt = Date.now();
		const inputAsString = inputToString(input.input);
		const replies: Reply[] = [];

		let manifest: AgentManifest;
		try {
			manifest = this.requireManifest(input.agentId);
		} catch (e) {
			const endedAt = Date.now();
			this.runsBuffer.record(
				buildRunRecord({
					runId,
					agentId: input.agentId,
					inputAsString,
					status: "failed",
					error: e instanceof Error ? e.message : String(e),
					startedAt,
					endedAt,
				}),
			);
			throw e;
		}

		const spanEmitter = new SpanEmitter({ traceSink: this.traceSink });
		const sessionId = input.sessionId ?? generateSessionId();

		try {
			const ctx = createExecutionContext(
				this.runner,
				this.manifests,
				this.localToolNames,
				{
					spanEmitter,
					sessionId,
					context: input.context,
					signal: input.signal,
					localTools: this.localTools,
					replyCollector: replies,
				},
			);
			const result = await execute(manifest, input.input ?? "", ctx);
			const endedAt = Date.now();
			const synthetic: InvokeResult = synthesizeInvokeResult({
				output: result.output,
				sessionId,
				startedAt,
				endedAt,
				model:
					manifest.kind === "llm"
						? `${manifest.model.provider}/${manifest.model.name}`
						: "(pipeline)",
				replies: replies.length > 0 ? replies : undefined,
			});
			this.runsBuffer.record(
				buildRunRecord({
					runId,
					agentId: input.agentId,
					inputAsString,
					status: "completed",
					result: synthetic,
					startedAt,
					endedAt,
				}),
			);
			return invokeResultToRunResult(synthetic, result.output);
		} catch (e) {
			const endedAt = Date.now();
			const message = e instanceof Error ? e.message : String(e);
			this.runsBuffer.record(
				buildRunRecord({
					runId,
					agentId: input.agentId,
					inputAsString,
					status: "failed",
					error: message,
					startedAt,
					endedAt,
				}),
			);
			throw e;
		}
	}

	async *stream(input: RunInput): AsyncGenerator<StreamEvent, void, void> {
		const manifest = this.requireManifest(input.agentId);
		const runId = generateRunId();
		const startedAt = Date.now();
		const inputAsString = inputToString(input.input);
		const spanEmitter = new SpanEmitter({ traceSink: this.traceSink });

		// Non-LLM kinds collapse to one `complete` event — the manifest
		// executor's pipelines don't natively stream events. LLM agents go
		// through runner.stream for native delta/reply emission.
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
				const endedAt = Date.now();
				const message = e instanceof Error ? e.message : String(e);
				this.runsBuffer.record(
					buildRunRecord({
						runId,
						agentId: input.agentId,
						inputAsString,
						status: "failed",
						error: message,
						startedAt,
						endedAt,
					}),
				);
				yield { type: "error", error: message };
				throw e;
			}
			return;
		}

		// LLM streaming path — render template, register temp agent, stream.
		const state = createInitialState(input.input ?? "", manifest.inputSchema);
		const renderedInstruction = renderTemplate(manifest.instruction, state);
		const tempId = `__stream_${manifest.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const def = manifestToAgentDefinition(
			{ ...manifest, instruction: renderedInstruction },
			this.localToolNames,
		);
		def.id = tempId;
		def.userPromptTemplate = undefined;
		this.runner.registerAgent(def);

		if (input.sessionId) {
			yield {
				type: "start",
				agentId: input.agentId,
				kind: "llm",
				sessionId: input.sessionId,
			};
		}
		let finalResult: InvokeResult | undefined;
		try {
			const userInput =
				manifest.prompt != null
					? renderTemplate(manifest.prompt, state)
					: state.userQuery != null
						? String(state.userQuery)
						: "";
			const iter = this.runner.stream(tempId, userInput, {
				sessionId: input.sessionId,
				context: input.context,
				signal: input.signal,
				spanEmitter,
			});
			for await (const event of iter) {
				this.onEvent?.(event);
				if (event.type === "done") finalResult = event.result;
				const mapped = mapCoreStreamEvent(event);
				if (mapped) yield mapped;
			}
			const endedAt = Date.now();
			if (finalResult) {
				this.runsBuffer.record(
					buildRunRecord({
						runId,
						agentId: input.agentId,
						inputAsString,
						status: "completed",
						result: finalResult,
						startedAt,
						endedAt,
					}),
				);
			}
		} catch (e) {
			const endedAt = Date.now();
			const message = e instanceof Error ? e.message : String(e);
			this.runsBuffer.record(
				buildRunRecord({
					runId,
					agentId: input.agentId,
					inputAsString,
					status: "failed",
					error: message,
					startedAt,
					endedAt,
				}),
			);
			yield { type: "error", error: message };
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

class RunsResourceImpl implements LocalRunsResource {
	constructor(private readonly buffer: RunsBuffer) {}
	async list(filter: RunListFilter = {}): Promise<RunListResult> {
		return this.buffer.list(filter);
	}
	async get(id: string): Promise<Run | null> {
		return this.buffer.get(id);
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

function synthesizeInvokeResult(args: {
	output: unknown;
	sessionId: string;
	startedAt: number;
	endedAt: number;
	model: string;
	replies?: Reply[];
}): InvokeResult {
	return {
		output:
			typeof args.output === "string"
				? args.output
				: JSON.stringify(args.output),
		invocationId: `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
		sessionId: args.sessionId,
		toolCalls: [],
		usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		duration: args.endedAt - args.startedAt,
		model: args.model,
		replies: args.replies,
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
