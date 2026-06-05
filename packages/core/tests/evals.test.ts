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
	passThreshold: 0.7,
	criteria: [
		{ id: "accuracy", name: "Accuracy", weight: 3 },
		{ id: "tone", name: "Tone", weight: 1, threshold: 0.5 },
	],
};

const dataset: EvalDataset = {
	id: "refund-cases",
	agentId: "support",
	name: "Refund Cases",
	items: [
		{
			id: "case_001",
			input: "What is the refund window?",
			expected: "30 days",
		},
	],
};

describe("eval scoring", () => {
	it("uses criterion ids and weighted averages", () => {
		const scored = scoreJudgeEnvelope(definition.criteria, 0.7, {
			overallScore: 0,
			passed: false,
			criteria: {
				accuracy: { score: 1, passed: true, reason: "matches" },
				tone: { score: 0, passed: false, reason: "cold" },
			},
			reason: "mixed",
		});

		expect(scored.overallScore).toBe(0.75);
		expect(scored.passed).toBe(true);
		expect(scored.criteria.accuracy.reason).toBe("matches");
		expect(Object.keys(scored.criteria)).toEqual(["accuracy", "tone"]);
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
		expect(summary.passed).toBe(false);
	});
});

describe("runEval", () => {
	it("snapshots eval, dataset, and agent inputs and stores case results", async () => {
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
			datasetId: dataset.id,
		});

		expect(run.status).toBe("completed");
		expect(run.summary?.overallScore).toBe(0.875);
		expect(run.summary?.passed).toBe(true);
		expect(run.snapshots.eval.id).toBe(definition.id);
		expect(run.snapshots.dataset.items[0].id).toBe("case_001");
		expect(run.caseResults[0].criteria.accuracy.score).toBe(1);
		expect((await store.getEvalRun(run.id))?.id).toBe(run.id);
	});
});

describe("EvalStore conformance", () => {
	it("MemoryStore stores eval definitions, datasets, and run history", async () => {
		const store = new MemoryStore().forUser("u1");
		await exerciseEvalStore(store);
	});
});

async function exerciseEvalStore(store: UnifiedStore) {
	await store.putEval(definition);
	await store.putDataset(dataset);
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
	const latest = await store.getEvalLatestScore({
		evalId: run.evalId,
		datasetId: run.datasetId,
		resolvedAgentVersion: run.agentVersion,
	});
	expect(latest?.runId).toBe(run.id);
	await store.putEvalLatestScore({
		...latestScoreFromEvalRun({ ...run, id: "evalrun_new" }),
		overallScore: 0.25,
	});
	expect(
		(
			await store.getEvalLatestScore({
				evalId: run.evalId,
				datasetId: run.datasetId,
				resolvedAgentVersion: run.agentVersion,
			})
		)?.runId,
	).toBe("evalrun_new");
}

class StubProvider implements ModelProvider {
	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		if (options.outputSchema) {
			return {
				text: JSON.stringify({
					overallScore: 0,
					passed: false,
					reason: "good answer",
					criteria: {
						accuracy: { score: 1, passed: true, reason: "correct" },
						tone: { score: 0.5, passed: true, reason: "acceptable" },
					},
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
