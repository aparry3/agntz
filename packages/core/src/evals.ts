import { formatAgentRef, isAliasName, isIsoTimestamp } from "./agent-ref.js";
import type { Runner } from "./runner.js";
import type {
	AgentDefinition,
	EvalCaseResult,
	EvalCriterion,
	EvalCriterionResult,
	EvalDataset,
	EvalDefinition,
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
	datasetId?: string;
	agentVersion?: string;
	signal?: AbortSignal;
}

export interface JudgeEnvelope {
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

export function scoreJudgeEnvelope(
	criteria: EvalCriterion[],
	passThreshold: number | undefined,
	envelope: unknown,
): {
	overallScore: number;
	passed: boolean;
	criteria: Record<string, EvalCriterionResult>;
	reason?: string;
} {
	const input = isRecord(envelope) ? (envelope as JudgeEnvelope) : {};
	const rawCriteria = isRecord(input.criteria) ? input.criteria : {};
	const normalizedThreshold = normalizePassThreshold(passThreshold);
	const results: Record<string, EvalCriterionResult> = {};

	for (const criterion of criteria) {
		const raw = rawCriteria[criterion.id];
		const row = isRecord(raw) ? raw : {};
		const score = clampScore(asNumber(row.score, 0));
		const threshold = clampScore(criterion.threshold ?? normalizedThreshold);
		results[criterion.id] = {
			score,
			passed: typeof row.passed === "boolean" ? row.passed : score >= threshold,
			reason:
				typeof row.reason === "string" && row.reason.trim()
					? row.reason
					: "No judge reason returned.",
		};
	}

	const overallScore =
		criteria.length > 0
			? weightedAverage(
					criteria,
					(criterion) => results[criterion.id]?.score ?? 0,
				)
			: clampScore(asNumber(input.overallScore, 0));
	const passed = overallScore >= normalizedThreshold;

	return {
		overallScore,
		passed,
		criteria: results,
		reason: typeof input.reason === "string" ? input.reason : undefined,
	};
}

export function summarizeEvalRun(
	definition: EvalDefinition,
	caseResults: EvalCaseResult[],
): EvalRunSummary {
	const completed = caseResults.filter((r) => r.status === "completed");
	const failed = caseResults.filter((r) => r.status === "failed");
	const skipped = caseResults.filter(
		(r) => r.status === "skipped" || r.status === "cancelled",
	);
	const overallScore =
		completed.length > 0
			? completed.reduce((sum, r) => sum + r.score, 0) / completed.length
			: 0;
	const passThreshold = normalizePassThreshold(definition.passThreshold);
	const criteriaSummary: EvalRunSummary["criteria"] = {};

	for (const criterion of definition.criteria) {
		const rows = completed
			.map((result) => result.criteria[criterion.id])
			.filter((result): result is EvalCriterionResult => Boolean(result));
		const score =
			rows.length > 0
				? rows.reduce((sum, result) => sum + result.score, 0) / rows.length
				: 0;
		const threshold = normalizePassThreshold(
			criterion.threshold ?? definition.passThreshold,
		);
		criteriaSummary[criterion.id] = {
			score,
			passed: rows.length > 0 && score >= threshold,
			completedCases: rows.length,
		};
	}

	return {
		totalCases: caseResults.length,
		completedCases: completed.length,
		failedCases: failed.length,
		skippedCases: skipped.length,
		overallScore,
		passed:
			caseResults.length > 0 &&
			completed.length === caseResults.length &&
			overallScore >= passThreshold,
		criteria: criteriaSummary,
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
		if (filters.datasetId && run.datasetId !== filters.datasetId) return false;
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
	const definition = await store.getEval(options.evalId);
	if (!definition) throw new Error(`Eval "${options.evalId}" not found`);
	if (!definition.criteria.length) {
		throw new Error(
			`Eval "${definition.id}" must define at least one criterion`,
		);
	}
	const datasetId = options.datasetId ?? definition.defaultDatasetId;
	if (!datasetId) {
		throw new Error(
			`Eval "${definition.id}" does not specify a default dataset; pass datasetId`,
		);
	}
	const dataset = await store.getDataset(datasetId);
	if (!dataset) throw new Error(`Dataset "${datasetId}" not found`);

	const target = await resolveEvalAgent(
		runner,
		definition,
		options.agentVersion,
	);
	const startedAt = new Date().toISOString();
	const run: EvalRun = {
		id: generateId("evalrun"),
		evalId: definition.id,
		datasetId: dataset.id,
		agentId: definition.agentId,
		agentVersion: target.resolvedVersion,
		requestedAgentVersion: target.requestedVersion,
		status: "running",
		startedAt,
		snapshots: {
			eval: cloneJson(definition),
			dataset: cloneJson(dataset),
			agent: cloneJson(target.agent),
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
					run.caseResults.push({
						itemId: item.id,
						status: "cancelled",
						input: item.input,
						expected: item.expected,
						criteria: {},
						score: 0,
						passed: false,
						error: "Eval run cancelled.",
					});
					continue;
				}
				const result = await runCase({
					runner,
					judgeId,
					agentRef: target.agentRef,
					definition,
					dataset,
					item,
					signal: options.signal,
				});
				run.caseResults.push(result);
				await store.putEvalRun({ ...run, caseResults: [...run.caseResults] });
			}
		} finally {
			runner.deregisterAgent(judgeId);
		}

		run.summary = summarizeEvalRun(definition, run.caseResults);
		run.status = options.signal?.aborted ? "cancelled" : "completed";
		run.endedAt = new Date().toISOString();
		await store.putEvalRun(run);
		return run;
	} catch (error) {
		run.status = "failed";
		run.error = error instanceof Error ? error.message : String(error);
		run.summary = summarizeEvalRun(definition, run.caseResults);
		run.endedAt = new Date().toISOString();
		await store.putEvalRun(run);
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
			"You are the hidden Agntz eval judge. Score the target agent output against each rubric criterion. Return only the requested structured JSON.",
		model: definition.judgeModel ?? DEFAULT_JUDGE_MODEL,
		outputSchema: judgeOutputSchema(definition.criteria),
	};
}

async function runCase(args: {
	runner: Runner;
	judgeId: string;
	agentRef: string;
	definition: EvalDefinition;
	dataset: EvalDataset;
	item: EvalDataset["items"][number];
	signal?: AbortSignal;
}): Promise<EvalCaseResult> {
	const started = Date.now();
	let agentOutput = "";
	let usage: TokenUsage | undefined;
	let invocationId: string | undefined;
	try {
		const result = await args.runner.invoke(args.agentRef, args.item.input, {
			signal: args.signal,
		});
		agentOutput = result.output;
		usage = result.usage;
		invocationId = result.invocationId;
	} catch (error) {
		return failedCase(args.item, {
			error: `Target agent failed: ${formatError(error)}`,
			duration: Date.now() - started,
		});
	}

	try {
		const judgePrompt = JSON.stringify(
			{
				input: args.item.input,
				expected: args.item.expected ?? null,
				actual: agentOutput,
				itemMetadata: args.item.metadata ?? {},
				datasetMetadata: args.dataset.metadata ?? {},
				criteria: args.definition.criteria.map((criterion) => ({
					id: criterion.id,
					name: criterion.name,
					description: criterion.description ?? "",
					threshold:
						criterion.threshold ?? args.definition.passThreshold ?? undefined,
				})),
				passThreshold: normalizePassThreshold(args.definition.passThreshold),
			},
			null,
			2,
		);
		const judged = await args.runner.invoke(args.judgeId, judgePrompt, {
			signal: args.signal,
		});
		const parsed = parseJudgeOutputText(judged.output);
		const scored = scoreJudgeEnvelope(
			args.definition.criteria,
			args.definition.passThreshold,
			parsed,
		);
		return {
			itemId: args.item.id,
			status: "completed",
			input: args.item.input,
			expected: args.item.expected,
			output: agentOutput,
			invocationId,
			usage,
			duration: Date.now() - started,
			criteria: scored.criteria,
			score: scored.overallScore,
			passed: scored.passed,
			reason: scored.reason,
		};
	} catch (error) {
		return failedCase(args.item, {
			output: agentOutput,
			invocationId,
			usage,
			error: `Judge failed: ${formatError(error)}`,
			duration: Date.now() - started,
		});
	}
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
		expected: item.expected,
		output: opts.output,
		invocationId: opts.invocationId,
		usage: opts.usage,
		duration: opts.duration,
		criteria: {},
		score: 0,
		passed: false,
		error: opts.error,
	};
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

function judgeOutputSchema(criteria: EvalCriterion[]): Record<string, unknown> {
	const criterionProperties: Record<string, unknown> = {};
	for (const criterion of criteria) {
		criterionProperties[criterion.id] = {
			type: "object",
			additionalProperties: false,
			required: ["score", "passed", "reason"],
			properties: {
				score: { type: "number", minimum: 0, maximum: 1 },
				passed: { type: "boolean" },
				reason: { type: "string" },
			},
		};
	}
	return {
		type: "object",
		additionalProperties: false,
		required: ["overallScore", "passed", "criteria", "reason"],
		properties: {
			overallScore: { type: "number", minimum: 0, maximum: 1 },
			passed: { type: "boolean" },
			reason: { type: "string" },
			criteria: {
				type: "object",
				additionalProperties: false,
				required: criteria.map((c) => c.id),
				properties: criterionProperties,
			},
		},
	};
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

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampScore(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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
