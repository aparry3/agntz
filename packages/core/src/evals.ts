import { formatAgentRef, isAliasName, isIsoTimestamp } from "./agent-ref.js";
import type { Runner } from "./runner.js";
import type {
	AgentDefinition,
	ContentBlock,
	EvalCaseResult,
	EvalCriterion,
	EvalCriterionResult,
	EvalDataset,
	EvalDefinition,
	EvalInput,
	EvalLatestScore,
	EvalOutcome,
	EvalRun,
	EvalRunListFilters,
	EvalRunListResult,
	EvalRunSummary,
	EvalStore,
	ModelConfig,
	TokenUsage,
} from "./types.js";
import { generateId } from "./utils/id.js";

const DEFAULT_PASS_THRESHOLD = 0.7;
const DEFAULT_JUDGE_MODEL: ModelConfig = {
	provider: "openai",
	name: "gpt-5.4-mini",
};

export interface RunEvalOptions {
	evalId: string;
	evalVersion?: string;
	datasetId?: string;
	datasetVersion?: string;
	agentVersion?: string;
	criterionIds?: string[];
	signal?: AbortSignal;
}

export interface JudgeEnvelope {
	score?: unknown;
	overallScore?: unknown;
	passed?: unknown;
	criteria?: unknown;
	reason?: unknown;
}

export function normalizePassThreshold(value: number | undefined): number {
	return clampScore(value ?? DEFAULT_PASS_THRESHOLD);
}

export function normalizeCriterionWeight(criterion: EvalCriterion): number {
	const weight = criterion.weight ?? 1;
	return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

export function evalPassPolicyMinimum(
	definition: Pick<EvalDefinition, "passPolicy" | "passThreshold">,
): number | undefined {
	const value =
		typeof definition.passPolicy?.minimumScore === "number"
			? definition.passPolicy.minimumScore
			: typeof definition.passThreshold === "number"
				? definition.passThreshold
				: undefined;
	return value === undefined ? undefined : clampScore(value);
}

export function criterionGateMinimum(
	criterion: Pick<EvalCriterion, "gate" | "threshold">,
): number | undefined {
	const value =
		typeof criterion.gate?.minimumScore === "number"
			? criterion.gate.minimumScore
			: typeof criterion.threshold === "number"
				? criterion.threshold
				: undefined;
	return value === undefined ? undefined : clampScore(value);
}

export function criterionRubric(criterion: EvalCriterion): string {
	return criterion.rubric ?? criterion.description ?? "";
}

export function evalJudgeModel(definition: EvalDefinition): ModelConfig {
	return (
		definition.judge?.model ?? definition.judgeModel ?? DEFAULT_JUDGE_MODEL
	);
}

export function scoreCriterionJudgeOutput(
	criterion: EvalCriterion,
	envelope: unknown,
): EvalCriterionResult {
	const input = isRecord(envelope) ? envelope : {};
	const criteria = isRecord(input.criteria) ? input.criteria : undefined;
	const raw = criteria?.[criterion.id];
	const row = isRecord(raw) ? raw : input;
	const score = clampScore(asNumber(row.score, 0));
	const minimumScore = criterionGateMinimum(criterion);
	const gate =
		minimumScore === undefined
			? undefined
			: { minimumScore, passed: score >= minimumScore };
	return {
		score,
		passed: gate ? gate.passed : true,
		reason:
			typeof row.reason === "string" && row.reason.trim()
				? row.reason
				: "No judge reason returned.",
		gate,
	};
}

export function scoreJudgeEnvelope(
	criteria: EvalCriterion[],
	passThreshold: number | undefined,
	envelope: unknown,
): {
	overallScore: number;
	passed: boolean;
	outcome: EvalOutcome;
	gateFailures: string[];
	criteria: Record<string, EvalCriterionResult>;
	reason?: string;
} {
	const input = isRecord(envelope) ? (envelope as JudgeEnvelope) : {};
	const results: Record<string, EvalCriterionResult> = {};
	for (const criterion of criteria) {
		results[criterion.id] = scoreCriterionJudgeOutput(criterion, input);
	}
	const overallScore =
		criteria.length > 0
			? weightedAverage(
					criteria,
					(criterion) => results[criterion.id]?.score ?? 0,
				)
			: clampScore(asNumber(input.overallScore, 0));
	const passMinimum =
		typeof passThreshold === "number" ? clampScore(passThreshold) : undefined;
	const derived = deriveOutcome({
		score: overallScore,
		passMinimum,
		criteria,
		results,
	});
	return {
		overallScore,
		passed: derived.passed,
		outcome: derived.outcome,
		gateFailures: derived.gateFailures,
		criteria: results,
		reason: typeof input.reason === "string" ? input.reason : undefined,
	};
}

export function summarizeEvalRun(
	definition: EvalDefinition,
	caseResults: EvalCaseResult[],
	options: { criterionIds?: string[] } = {},
): EvalRunSummary {
	const criteria = selectCriteria(definition.criteria, options.criterionIds);
	return buildEvalSummary(definition, criteria, caseResults, true);
}

export function latestScoreFromEvalRun(run: EvalRun): EvalLatestScore {
	const summary = run.summary;
	return {
		evalId: run.evalId,
		evalVersion: run.evalVersion,
		datasetId: run.datasetId,
		datasetVersion: run.datasetVersion,
		agentId: run.agentId,
		requestedAgentVersion: run.requestedAgentVersion,
		resolvedAgentVersion: run.agentVersion,
		runId: run.id,
		status: run.status,
		summary,
		overallScore: summary?.overallScore ?? 0,
		passed: summary?.passed ?? false,
		startedAt: run.startedAt,
		endedAt: run.endedAt,
		updatedAt: new Date().toISOString(),
	};
}

export function listEvalRunsInProcess(
	runs: EvalRun[],
	filters: EvalRunListFilters = {},
): EvalRunListResult {
	const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
	let rows = runs.filter((run) => {
		if (filters.agentId && run.agentId !== filters.agentId) return false;
		if (filters.evalId && run.evalId !== filters.evalId) return false;
		if (filters.evalVersion && run.evalVersion !== filters.evalVersion)
			return false;
		if (filters.datasetId && run.datasetId !== filters.datasetId) return false;
		if (filters.datasetVersion && run.datasetVersion !== filters.datasetVersion)
			return false;
		if (filters.agentVersion && run.agentVersion !== filters.agentVersion)
			return false;
		if (filters.status && run.status !== filters.status) return false;
		if (filters.startedAfter && run.startedAt < filters.startedAfter)
			return false;
		if (filters.startedBefore && run.startedAt > filters.startedBefore)
			return false;
		return true;
	});
	rows = rows
		.slice()
		.sort(
			(a, b) =>
				b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id),
		);

	let startIdx = 0;
	if (filters.cursor) {
		const decoded = decodeEvalRunCursor(filters.cursor);
		if (decoded) {
			startIdx = rows.findIndex(
				(r) =>
					r.startedAt < decoded.startedAt ||
					(r.startedAt === decoded.startedAt && r.id < decoded.id),
			);
			if (startIdx === -1) startIdx = rows.length;
		}
	}

	const page = rows.slice(startIdx, startIdx + limit);
	const cursor =
		page.length === limit && startIdx + limit < rows.length
			? encodeEvalRunCursor({
					startedAt: page[page.length - 1].startedAt,
					id: page[page.length - 1].id,
				})
			: undefined;
	return { rows: page, cursor };
}

export async function runEval(
	runner: Runner,
	store: EvalStore,
	options: RunEvalOptions,
): Promise<EvalRun> {
	const resolvedEval = await resolveEvalDefinition(
		store,
		options.evalId,
		options.evalVersion,
	);
	const definition = resolvedEval.definition;
	if (!definition.criteria.length) {
		throw new Error(
			`Eval "${definition.id}" must define at least one criterion`,
		);
	}
	const criteria = selectCriteria(definition.criteria, options.criterionIds);
	if (criteria.length === 0) {
		throw new Error(`Eval "${definition.id}" did not match any criterionIds`);
	}
	const defaultDatasetId =
		options.datasetId ??
		definition.defaultDataset?.id ??
		definition.defaultDatasetId;
	if (!defaultDatasetId) {
		throw new Error(
			`Eval "${definition.id}" does not specify a default dataset; pass datasetId`,
		);
	}
	const requestedDatasetVersion =
		options.datasetVersion ??
		(options.datasetId ? undefined : definition.defaultDataset?.version);
	const resolvedDataset = await resolveEvalDataset(
		store,
		defaultDatasetId,
		requestedDatasetVersion,
	);
	const dataset = resolvedDataset.dataset;
	if (dataset.agentId !== definition.agentId) {
		throw new Error(
			`Dataset "${dataset.id}" belongs to agent "${dataset.agentId}", not "${definition.agentId}"`,
		);
	}

	const target = await resolveEvalAgent(
		runner,
		definition,
		options.agentVersion,
	);
	const startedAt = new Date().toISOString();
	const criterionIds = criteria.map((criterion) => criterion.id);
	const partial =
		Boolean(options.criterionIds?.length) &&
		criterionIds.length !== definition.criteria.length;
	const run: EvalRun = {
		id: generateId("evalrun"),
		evalId: definition.id,
		requestedEvalVersion: resolvedEval.requestedVersion,
		evalVersion: resolvedEval.resolvedVersion,
		datasetId: dataset.id,
		requestedDatasetVersion: resolvedDataset.requestedVersion,
		datasetVersion: resolvedDataset.resolvedVersion,
		agentId: definition.agentId,
		agentVersion: target.resolvedVersion,
		requestedAgentVersion: target.requestedVersion,
		criterionIds,
		partial,
		status: "running",
		startedAt,
		snapshots: {
			eval: cloneJson(definition),
			dataset: cloneJson(dataset),
			agent: cloneJson(target.agent),
			evalVersion: resolvedEval.resolvedVersion,
			requestedEvalVersion: resolvedEval.requestedVersion,
			datasetVersion: resolvedDataset.resolvedVersion,
			requestedDatasetVersion: resolvedDataset.requestedVersion,
			agentVersion: target.resolvedVersion,
			requestedAgentVersion: target.requestedVersion,
		},
		caseResults: [],
	};
	await store.putEvalRun(run);

	try {
		const judgeId = `__agntz_eval_judge_${run.id}`;
		runner.registerAgent(createEvalJudgeAgent(judgeId, definition));
		try {
			for (const item of dataset.items) {
				if (options.signal?.aborted) {
					run.caseResults.push(cancelledCase(item));
					continue;
				}
				const result = await runCase({
					runner,
					judgeId,
					agentRef: target.agentRef,
					definition,
					dataset,
					item,
					criteria,
					signal: options.signal,
				});
				run.caseResults.push(result);
				await store.putEvalRun({ ...run, caseResults: [...run.caseResults] });
			}
		} finally {
			runner.deregisterAgent(judgeId);
		}

		run.summary = summarizeEvalRun(definition, run.caseResults, {
			criterionIds,
		});
		run.status = options.signal?.aborted ? "cancelled" : "completed";
		run.endedAt = new Date().toISOString();
		await store.putEvalRun(run);
		if (!run.partial)
			await store.putEvalLatestScore(latestScoreFromEvalRun(run));
		return run;
	} catch (error) {
		run.status = "failed";
		run.error = error instanceof Error ? error.message : String(error);
		run.summary = summarizeEvalRun(definition, run.caseResults, {
			criterionIds,
		});
		run.endedAt = new Date().toISOString();
		await store.putEvalRun(run);
		if (!run.partial)
			await store.putEvalLatestScore(latestScoreFromEvalRun(run));
		return run;
	}
}

export function createEvalJudgeAgent(
	id: string,
	definition: EvalDefinition,
): AgentDefinition {
	return {
		id,
		name: "Agntz Eval Judge",
		systemPrompt:
			"You are the hidden Agntz eval judge. Score the target agent output against one rubric criterion. Return only the requested structured JSON.",
		model: evalJudgeModel(definition),
		outputSchema: judgeOutputSchema(),
	};
}

async function runCase(args: {
	runner: Runner;
	judgeId: string;
	agentRef: string;
	definition: EvalDefinition;
	dataset: EvalDataset;
	item: EvalDataset["items"][number];
	criteria: EvalCriterion[];
	signal?: AbortSignal;
}): Promise<EvalCaseResult> {
	const started = Date.now();
	let agentOutput = "";
	let usage: TokenUsage | undefined;
	let invocationId: string | undefined;
	try {
		const result = await args.runner.invoke(
			args.agentRef,
			toRunnerInput(args.item.input),
			{
				signal: args.signal,
			},
		);
		agentOutput = result.output;
		usage = result.usage;
		invocationId = result.invocationId;
	} catch (error) {
		if (args.signal?.aborted) return cancelledCase(args.item);
		return failedCase(args.item, {
			error: `Target agent failed: ${formatError(error)}`,
			duration: Date.now() - started,
		});
	}

	const pairs = await Promise.all(
		args.criteria.map(async (criterion) => {
			try {
				const judged = await args.runner.invoke(
					args.judgeId,
					judgeCriterionPrompt({
						definition: args.definition,
						dataset: args.dataset,
						item: args.item,
						criterion,
						actual: agentOutput,
					}),
					{ signal: args.signal },
				);
				return [
					criterion.id,
					scoreCriterionJudgeOutput(
						criterion,
						parseJudgeOutputText(judged.output),
					),
				] as const;
			} catch (error) {
				if (args.signal?.aborted) throw error;
				return [
					criterion.id,
					failedCriterionResult(
						criterion,
						`Judge failed: ${formatError(error)}`,
					),
				] as const;
			}
		}),
	).catch((error) => {
		if (args.signal?.aborted) return null;
		throw error;
	});
	if (pairs === null) return cancelledCase(args.item);

	const criteria = Object.fromEntries(pairs) as Record<
		string,
		EvalCriterionResult
	>;
	const score = weightedAverage(
		args.criteria,
		(criterion) => criteria[criterion.id]?.score ?? 0,
	);
	const derived = deriveOutcome({
		score,
		passMinimum: evalPassPolicyMinimum(args.definition),
		criteria: args.criteria,
		results: criteria,
	});
	return {
		itemId: args.item.id,
		status: "completed",
		input: args.item.input,
		reference: args.item.reference ?? args.item.expected,
		expected: args.item.expected ?? args.item.reference,
		tags: args.item.tags,
		output: agentOutput,
		invocationId,
		usage,
		duration: Date.now() - started,
		criteria,
		score,
		passed: derived.passed,
		outcome: derived.outcome,
		gateFailures: derived.gateFailures,
	};
}

function cancelledCase(item: EvalDataset["items"][number]): EvalCaseResult {
	return {
		itemId: item.id,
		status: "cancelled",
		input: item.input,
		reference: item.reference ?? item.expected,
		expected: item.expected ?? item.reference,
		tags: item.tags,
		criteria: {},
		score: 0,
		passed: false,
		outcome: "failed",
		gateFailures: ["case cancelled before scoring"],
		error: "Eval run cancelled.",
	};
}

function failedCase(
	item: EvalDataset["items"][number],
	opts: {
		output?: string;
		invocationId?: string;
		usage?: TokenUsage;
		duration: number;
		error: string;
	},
): EvalCaseResult {
	return {
		itemId: item.id,
		status: "failed",
		input: item.input,
		reference: item.reference ?? item.expected,
		expected: item.expected ?? item.reference,
		tags: item.tags,
		output: opts.output,
		invocationId: opts.invocationId,
		usage: opts.usage,
		duration: opts.duration,
		criteria: {},
		score: 0,
		passed: false,
		outcome: "failed",
		gateFailures: ["case failed before scoring"],
		error: opts.error,
	};
}

async function resolveEvalDefinition(
	store: EvalStore,
	evalId: string,
	version: string | undefined,
): Promise<{
	definition: EvalDefinition;
	requestedVersion?: string;
	resolvedVersion?: string;
}> {
	if (!version) {
		const definition = await store.getEval(evalId);
		if (!definition) throw new Error(`Eval "${evalId}" not found`);
		return {
			definition,
			resolvedVersion:
				definition.version ?? definition.updatedAt ?? definition.createdAt,
		};
	}
	const resolvedVersion = await resolveEvalVersionRef(store, evalId, version);
	const definition = await store.getEvalVersion(evalId, resolvedVersion);
	if (!definition) throw new Error(`Eval "${evalId}@${version}" not found`);
	return { definition, requestedVersion: version, resolvedVersion };
}

async function resolveEvalDataset(
	store: EvalStore,
	datasetId: string,
	version: string | undefined,
): Promise<{
	dataset: EvalDataset;
	requestedVersion?: string;
	resolvedVersion?: string;
}> {
	if (!version) {
		const dataset = await store.getDataset(datasetId);
		if (!dataset) throw new Error(`Dataset "${datasetId}" not found`);
		return {
			dataset,
			resolvedVersion:
				dataset.version ?? dataset.updatedAt ?? dataset.createdAt,
		};
	}
	const resolvedVersion = await resolveDatasetVersionRef(
		store,
		datasetId,
		version,
	);
	const dataset = await store.getDatasetVersion(datasetId, resolvedVersion);
	if (!dataset) throw new Error(`Dataset "${datasetId}@${version}" not found`);
	return { dataset, requestedVersion: version, resolvedVersion };
}

async function resolveEvalVersionRef(
	store: EvalStore,
	evalId: string,
	version: string,
): Promise<string> {
	if (version === "latest") {
		const latest = (await store.listEvalVersions(evalId))[0]?.createdAt;
		if (!latest) throw new Error(`Eval "${evalId}@latest" not found`);
		return latest;
	}
	if (!isIsoTimestamp(version) && isAliasName(version)) {
		const resolved = await store.resolveEvalVersionAlias(evalId, version);
		if (!resolved) throw new Error(`Eval "${evalId}@${version}" not found`);
		return resolved;
	}
	return version;
}

async function resolveDatasetVersionRef(
	store: EvalStore,
	datasetId: string,
	version: string,
): Promise<string> {
	if (version === "latest") {
		const latest = (await store.listDatasetVersions(datasetId))[0]?.createdAt;
		if (!latest) throw new Error(`Dataset "${datasetId}@latest" not found`);
		return latest;
	}
	if (!isIsoTimestamp(version) && isAliasName(version)) {
		const resolved = await store.resolveDatasetVersionAlias(datasetId, version);
		if (!resolved)
			throw new Error(`Dataset "${datasetId}@${version}" not found`);
		return resolved;
	}
	return version;
}

async function resolveEvalAgent(
	runner: Runner,
	definition: EvalDefinition,
	version: string | undefined,
): Promise<{
	agent: AgentDefinition;
	agentRef: string;
	requestedVersion?: string;
	resolvedVersion?: string;
}> {
	const requestedVersion = version;
	if (!version) {
		const agent = await runner.agents.getAgent(definition.agentId);
		if (!agent) throw new Error(`Agent "${definition.agentId}" not found`);
		return {
			agent,
			agentRef: definition.agentId,
			resolvedVersion: agent.createdAt,
		};
	}

	if (version === "latest") {
		const versions = await runner.agents.listAgentVersions(definition.agentId);
		const latest = versions[0]?.createdAt;
		if (!latest) throw new Error(`Agent "${definition.agentId}" not found`);
		const agent = await runner.agents.getAgentVersion(
			definition.agentId,
			latest,
		);
		if (!agent) {
			throw new Error(`Agent "${definition.agentId}@${latest}" not found`);
		}
		return {
			agent,
			agentRef: formatAgentRef({ agentId: definition.agentId, version }),
			requestedVersion,
			resolvedVersion: latest,
		};
	}

	if (!isIsoTimestamp(version) && isAliasName(version)) {
		const resolved = await runner.agents.resolveAgentAlias(
			definition.agentId,
			version,
		);
		if (!resolved) {
			throw new Error(`Agent "${definition.agentId}@${version}" not found`);
		}
		const agent = await runner.agents.getAgentVersion(
			definition.agentId,
			resolved,
		);
		if (!agent) {
			throw new Error(`Agent "${definition.agentId}@${resolved}" not found`);
		}
		return {
			agent,
			agentRef: formatAgentRef({ agentId: definition.agentId, version }),
			requestedVersion,
			resolvedVersion: resolved,
		};
	}

	const agent = await runner.agents.getAgentVersion(
		definition.agentId,
		version,
	);
	if (!agent)
		throw new Error(`Agent "${definition.agentId}@${version}" not found`);
	return {
		agent,
		agentRef: formatAgentRef({ agentId: definition.agentId, version }),
		requestedVersion,
		resolvedVersion: version,
	};
}

function judgeOutputSchema(): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		required: ["score", "reason"],
		properties: {
			score: { type: "number", minimum: 0, maximum: 1 },
			reason: { type: "string" },
		},
	};
}

function judgeCriterionPrompt(args: {
	definition: EvalDefinition;
	dataset: EvalDataset;
	item: EvalDataset["items"][number];
	criterion: EvalCriterion;
	actual: string;
}): string {
	return JSON.stringify(
		{
			instruction:
				"Score the target agent output for this one criterion. Return JSON with score and reason only.",
			input: args.item.input,
			reference: args.item.reference ?? args.item.expected ?? null,
			actual: args.actual,
			itemTags: args.item.tags ?? [],
			itemNotes: args.item.notes ?? null,
			itemMetadata: args.item.metadata ?? {},
			datasetMetadata: args.dataset.metadata ?? {},
			criterion: {
				id: args.criterion.id,
				name: args.criterion.name,
				rubric: criterionRubric(args.criterion),
				weight: normalizeCriterionWeight(args.criterion),
				gate: args.criterion.gate ?? undefined,
			},
			eval: {
				id: args.definition.id,
				name: args.definition.name,
			},
		},
		null,
		2,
	);
}

export function parseJudgeOutputText(text: string): unknown {
	const trimmed = text.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (match) return JSON.parse(match[1]);
		throw new Error("Judge did not return parseable JSON");
	}
}

function buildEvalSummary(
	definition: EvalDefinition,
	criteria: EvalCriterion[],
	caseResults: EvalCaseResult[],
	includeTags: boolean,
): EvalRunSummary {
	const completed = caseResults.filter((r) => r.status === "completed");
	const scored = caseResults.filter(
		(r) => r.status === "completed" || r.status === "failed",
	);
	const failed = caseResults.filter((r) => r.status === "failed");
	const skipped = caseResults.filter(
		(r) => r.status === "skipped" || r.status === "cancelled",
	);
	const overallScore =
		scored.length > 0
			? scored.reduce((sum, r) => sum + r.score, 0) / scored.length
			: 0;
	const criteriaSummary: EvalRunSummary["criteria"] = {};
	const summaryResults: Record<string, EvalCriterionResult> = {};

	for (const criterion of criteria) {
		const rows = scored
			.map((result) => result.criteria[criterion.id])
			.filter((result): result is EvalCriterionResult => Boolean(result));
		const score =
			rows.length > 0
				? rows.reduce((sum, result) => sum + result.score, 0) / rows.length
				: 0;
		const minimumScore = criterionGateMinimum(criterion);
		const gate =
			minimumScore === undefined
				? undefined
				: { minimumScore, passed: rows.length > 0 && score >= minimumScore };
		const passed = gate ? gate.passed : true;
		criteriaSummary[criterion.id] = {
			score,
			passed,
			completedCases: rows.length,
			gate,
		};
		summaryResults[criterion.id] = {
			score,
			passed,
			reason: "",
			gate,
		};
	}

	const derived = deriveOutcome({
		score: overallScore,
		passMinimum: evalPassPolicyMinimum(definition),
		criteria,
		results: summaryResults,
		caseFailureCount: failed.length,
		incompleteCaseCount: skipped.length,
	});
	const summary: EvalRunSummary = {
		totalCases: caseResults.length,
		completedCases: completed.length,
		failedCases: failed.length,
		skippedCases: skipped.length,
		overallScore,
		passed: derived.passed,
		outcome: derived.outcome,
		gateFailures: derived.gateFailures,
		criteria: criteriaSummary,
	};
	if (includeTags) {
		const tagNames = new Set<string>();
		for (const result of caseResults) {
			for (const tag of result.tags ?? []) tagNames.add(tag);
		}
		if (tagNames.size > 0) {
			summary.tags = {};
			for (const tag of Array.from(tagNames).sort()) {
				const tagSummary = buildEvalSummary(
					definition,
					criteria,
					caseResults.filter((result) => result.tags?.includes(tag)),
					false,
				);
				summary.tags[tag] = {
					totalCases: tagSummary.totalCases,
					completedCases: tagSummary.completedCases,
					failedCases: tagSummary.failedCases,
					skippedCases: tagSummary.skippedCases,
					overallScore: tagSummary.overallScore,
					passed: tagSummary.passed,
					outcome: tagSummary.outcome,
					gateFailures: tagSummary.gateFailures,
					criteria: tagSummary.criteria,
				};
			}
		}
	}
	return summary;
}

function deriveOutcome(args: {
	score: number;
	passMinimum?: number;
	criteria: EvalCriterion[];
	results: Record<string, EvalCriterionResult>;
	caseFailureCount?: number;
	incompleteCaseCount?: number;
}): { outcome: EvalOutcome; passed: boolean; gateFailures: string[] } {
	const gateFailures: string[] = [];
	if (args.caseFailureCount) {
		gateFailures.push(`${args.caseFailureCount} case(s) failed before scoring`);
	}
	if (args.incompleteCaseCount) {
		gateFailures.push(`${args.incompleteCaseCount} case(s) did not complete`);
	}
	if (args.passMinimum !== undefined && args.score < args.passMinimum) {
		gateFailures.push(
			`overall score ${formatScore(args.score)} below pass policy ${formatScore(args.passMinimum)}`,
		);
	}
	for (const criterion of args.criteria) {
		const minimumScore = criterionGateMinimum(criterion);
		if (minimumScore === undefined) continue;
		const score = args.results[criterion.id]?.score ?? 0;
		if (score < minimumScore) {
			gateFailures.push(
				`${criterion.id} score ${formatScore(score)} below gate ${formatScore(minimumScore)}`,
			);
		}
	}
	const hasConfiguredChecks =
		args.passMinimum !== undefined ||
		args.criteria.some(
			(criterion) => criterionGateMinimum(criterion) !== undefined,
		);
	const outcome =
		gateFailures.length > 0
			? "failed"
			: hasConfiguredChecks
				? "passed"
				: "score_only";
	return { outcome, passed: outcome !== "failed", gateFailures };
}

function failedCriterionResult(
	criterion: EvalCriterion,
	reason: string,
): EvalCriterionResult {
	const minimumScore = criterionGateMinimum(criterion);
	const gate =
		minimumScore === undefined
			? undefined
			: { minimumScore, passed: 0 >= minimumScore };
	return {
		score: 0,
		passed: gate ? gate.passed : true,
		reason,
		gate,
		error: reason,
	};
}

function selectCriteria(
	criteria: EvalCriterion[],
	criterionIds: string[] | undefined,
): EvalCriterion[] {
	if (!criterionIds?.length) return criteria;
	const requested = new Set(criterionIds);
	return criteria.filter((criterion) => requested.has(criterion.id));
}

function weightedAverage(
	criteria: EvalCriterion[],
	readScore: (criterion: EvalCriterion) => number,
): number {
	let weighted = 0;
	let totalWeight = 0;
	for (const criterion of criteria) {
		const weight = normalizeCriterionWeight(criterion);
		weighted += clampScore(readScore(criterion)) * weight;
		totalWeight += weight;
	}
	return totalWeight > 0 ? weighted / totalWeight : 0;
}

function toRunnerInput(input: EvalInput): string | ContentBlock[] {
	if (typeof input === "string" || Array.isArray(input)) return input;
	return JSON.stringify(input);
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampScore(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatScore(score: number): string {
	return clampScore(score).toFixed(2);
}

function encodeEvalRunCursor(cursor: {
	startedAt: string;
	id: string;
}): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeEvalRunCursor(
	cursor: string,
): { startedAt: string; id: string } | null {
	try {
		const parsed = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		) as { startedAt?: unknown; id?: unknown };
		if (typeof parsed.startedAt !== "string" || typeof parsed.id !== "string")
			return null;
		return { startedAt: parsed.startedAt, id: parsed.id };
	} catch {
		return null;
	}
}
