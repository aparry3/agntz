import { describe, expect, it } from "vitest";
import {
	MemoryStore,
	createRunner,
	latestScoreFromEvalRun,
	runEval,
	scoreJudgeEnvelope,
	summarizeEvalRun,
} from "../src/index.js";
import type {
	EvalDataset,
	EvalDefinition,
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
	UnifiedStore,
} from "../src/index.js";

const definition: EvalDefinition = {
	id: "support-quality",
	agentId: "support",
	name: "Support Quality",
	passPolicy: { minimumScore: 0.7 },
	criteria: [
		{
			id: "accuracy",
			name: "Accuracy",
			weight: 3,
			gate: { minimumScore: 0.75 },
			rubric: "Score factual correctness.",
		},
		{
			id: "tone",
			name: "Tone",
			weight: 1,
			rubric: "Score clarity and tone.",
		},
	],
};

const dataset: EvalDataset = {
	id: "refund-cases",
	agentId: "support",
	name: "Refund Cases",
	items: [
		{
			id: "case_001",
			input: { question: "What is the refund window?" },
			reference: "30 days",
			tags: ["happy-path", "refunds"],
		},
	],
};

describe("eval scoring", () => {
	it("derives criterion ids, gate status, and weighted averages", () => {
		const scored = scoreJudgeEnvelope(definition.criteria, 0.7, {
			criteria: {
				accuracy: { score: 1, reason: "matches" },
				tone: { score: 0, reason: "cold" },
			},
			reason: "mixed",
		});

		expect(scored.overallScore).toBe(0.75);
		expect(scored.outcome).toBe("passed");
		expect(scored.passed).toBe(true);
		expect(scored.criteria.accuracy.gate).toEqual({
			minimumScore: 0.75,
			passed: true,
		});
		expect(scored.criteria.tone.passed).toBe(true);
		expect(Object.keys(scored.criteria)).toEqual(["accuracy", "tone"]);
	});

	it("supports score-only summaries when no thresholds or gates exist", () => {
		const scoreOnly: EvalDefinition = {
			...definition,
			passPolicy: undefined,
			passThreshold: undefined,
			criteria: [{ id: "quality", name: "Quality", rubric: "Score quality." }],
		};
		const summary = summarizeEvalRun(scoreOnly, [
			{
				itemId: "case_001",
				status: "completed",
				input: "ok",
				criteria: {
					quality: { score: 0.1, passed: true, reason: "weak" },
				},
				score: 0.1,
				passed: true,
			},
		]);

		expect(summary.overallScore).toBe(0.1);
		expect(summary.outcome).toBe("score_only");
		expect(summary.passed).toBe(true);
		expect(summary.gateFailures).toEqual([]);
	});

	it("records aggregate and criterion gate failures", () => {
		const summary = summarizeEvalRun(definition, [
			{
				itemId: "case_001",
				status: "completed",
				input: "bad",
				criteria: {
					accuracy: {
						score: 0.5,
						passed: false,
						reason: "partial",
						gate: { minimumScore: 0.75, passed: false },
					},
					tone: { score: 1, passed: true, reason: "clear" },
				},
				score: 0.625,
				passed: false,
			},
		]);

		expect(summary.outcome).toBe("failed");
		expect(summary.passed).toBe(false);
		expect(summary.gateFailures).toEqual([
			"overall score 0.63 below pass policy 0.70",
			"accuracy score 0.50 below gate 0.75",
		]);
	});

	it("includes failed zero-score cases in the aggregate score", () => {
		const summary = summarizeEvalRun(definition, [
			{
				itemId: "case_001",
				status: "completed",
				input: "ok",
				criteria: {
					accuracy: { score: 1, passed: true, reason: "ok" },
					tone: { score: 1, passed: true, reason: "ok" },
				},
				score: 1,
				passed: true,
			},
			{
				itemId: "case_002",
				status: "failed",
				input: "bad",
				criteria: {},
				score: 0,
				passed: false,
				error: "target failed",
			},
		]);

		expect(summary.overallScore).toBe(0.5);
		expect(summary.failedCases).toBe(1);
		expect(summary.outcome).toBe("failed");
		expect(summary.gateFailures?.[0]).toBe("1 case(s) failed before scoring");
	});
});

describe("runEval", () => {
	it("snapshots resolved eval, dataset, and agent versions", async () => {
		const store = new MemoryStore();
		await store.putAgent({
			id: "support",
			name: "Support",
			systemPrompt: "Answer support questions.",
			model: { provider: "test", name: "target" },
		});
		await store.putEval(definition);
		await store.putDataset(dataset);
		const runner = createRunner({ store, modelProvider: new StubProvider() });

		const run = await runEval(runner, store, {
			evalId: definition.id,
			evalVersion: "latest",
			datasetId: dataset.id,
			datasetVersion: "latest",
			agentVersion: "latest",
		});

		expect(run.status).toBe("completed");
		expect(run.summary?.overallScore).toBe(0.875);
		expect(run.summary?.outcome).toBe("passed");
		expect(run.requestedEvalVersion).toBe("latest");
		expect(run.evalVersion).toBeTruthy();
		expect(run.datasetVersion).toBeTruthy();
		expect(run.snapshots.eval.id).toBe(definition.id);
		expect(run.snapshots.dataset.items[0].reference).toBe("30 days");
		expect(run.summary?.tags?.["happy-path"].overallScore).toBe(0.875);
		expect(run.caseResults[0].criteria.accuracy.score).toBe(1);
		expect((await store.getEvalRun(run.id))?.id).toBe(run.id);

		const latest = await store.getEvalLatestScore({
			evalId: run.evalId,
			evalVersion: run.evalVersion,
			datasetId: run.datasetId,
			datasetVersion: run.datasetVersion,
			resolvedAgentVersion: run.agentVersion,
		});
		expect(latest?.runId).toBe(run.id);
	});

	it("does not overwrite latest score for diagnostic criterion runs", async () => {
		const store = new MemoryStore();
		await store.putAgent({
			id: "support",
			name: "Support",
			systemPrompt: "Answer support questions.",
			model: { provider: "test", name: "target" },
		});
		await store.putEval(definition);
		await store.putDataset(dataset);
		const runner = createRunner({ store, modelProvider: new StubProvider() });

		const full = await runEval(runner, store, {
			evalId: definition.id,
			datasetId: dataset.id,
		});
		const partial = await runEval(runner, store, {
			evalId: definition.id,
			datasetId: dataset.id,
			criterionIds: ["tone"],
		});

		expect(partial.partial).toBe(true);
		expect(partial.criterionIds).toEqual(["tone"]);
		const latest = await store.getEvalLatestScore({
			evalId: full.evalId,
			evalVersion: full.evalVersion,
			datasetId: full.datasetId,
			datasetVersion: full.datasetVersion,
			resolvedAgentVersion: full.agentVersion,
		});
		expect(latest?.runId).toBe(full.id);
	});
});

describe("EvalStore conformance", () => {
	it("MemoryStore stores versioned eval definitions, datasets, and run history", async () => {
		const store = new MemoryStore().forUser("u1");
		await exerciseEvalStore(store);
	});
});

async function exerciseEvalStore(store: UnifiedStore) {
	await store.putEval(definition);
	await store.putDataset(dataset);
	const [evalVersion] = await store.listEvalVersions(definition.id);
	const [datasetVersion] = await store.listDatasetVersions(dataset.id);
	expect(evalVersion.createdAt).toBeTruthy();
	expect(datasetVersion.createdAt).toBeTruthy();
	await store.setEvalVersionAlias(
		definition.id,
		evalVersion.createdAt,
		"baseline",
	);
	await store.setDatasetVersionAlias(
		dataset.id,
		datasetVersion.createdAt,
		"baseline",
	);
	expect(await store.resolveEvalVersionAlias(definition.id, "baseline")).toBe(
		evalVersion.createdAt,
	);
	expect(await store.resolveDatasetVersionAlias(dataset.id, "baseline")).toBe(
		datasetVersion.createdAt,
	);

	await store.putEval({ ...definition, name: "Support Quality v2" });
	expect(await store.listEvalVersions(definition.id)).toHaveLength(2);
	await store.activateEvalVersion(definition.id, evalVersion.createdAt);
	expect((await store.getEval(definition.id))?.version).toBe(
		evalVersion.createdAt,
	);

	expect(await store.listDatasets({ agentId: "support" })).toHaveLength(1);
	expect(await store.listDatasets({ agentId: "other" })).toHaveLength(0);
	expect(await store.getEval(definition.id)).toMatchObject({
		id: definition.id,
		agentId: "support",
	});
	expect(await store.listEvals({ agentId: "support" })).toHaveLength(1);
	expect(await store.listEvals({ agentId: "other" })).toHaveLength(0);
	expect(await store.getDataset(dataset.id)).toMatchObject({ id: dataset.id });

	const runnerStore = new MemoryStore();
	await runnerStore.putAgent({
		id: "support",
		name: "Support",
		systemPrompt: "Answer support questions.",
		model: { provider: "test", name: "target" },
	});
	await runnerStore.putEval(definition);
	await runnerStore.putDataset(dataset);
	const run = await runEval(
		createRunner({ store: runnerStore, modelProvider: new StubProvider() }),
		runnerStore,
		{ evalId: definition.id, datasetId: dataset.id },
	);
	await store.putEvalRun(run);
	await store.putEvalLatestScore(latestScoreFromEvalRun(run));
	const listed = await store.listEvalRuns({ agentId: "support" });
	expect(listed.rows.map((row) => row.id)).toEqual([run.id]);
	const latestKey = {
		evalId: run.evalId,
		evalVersion: run.evalVersion,
		datasetId: run.datasetId,
		datasetVersion: run.datasetVersion,
		resolvedAgentVersion: run.agentVersion,
	};
	const latest = await store.getEvalLatestScore(latestKey);
	expect(latest?.runId).toBe(run.id);
	await store.putEvalLatestScore({
		...latestScoreFromEvalRun({ ...run, id: "evalrun_new" }),
		overallScore: 0.25,
	});
	expect((await store.getEvalLatestScore(latestKey))?.runId).toBe(
		"evalrun_new",
	);
}

class StubProvider implements ModelProvider {
	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		if (options.outputSchema) {
			const prompt = String(options.messages.at(-1)?.content ?? "");
			const score = prompt.includes('"id": "accuracy"') ? 1 : 0.5;
			return {
				text: JSON.stringify({
					score,
					reason: score === 1 ? "correct" : "acceptable",
				}),
				usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
				finishReason: "stop",
			};
		}
		return {
			text: "The refund window is 30 days.",
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		};
	}
}
