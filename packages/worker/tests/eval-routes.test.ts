import {
	type GenerateTextOptions,
	type GenerateTextResult,
	MemoryStore,
	type ModelProvider,
	createRunner,
} from "@agntz/core";
import type { AgentManifest } from "@agntz/manifest";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function internalAuthHeaders() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
	} as const;
}

describe("eval routes", () => {
	it("starts an eval run asynchronously and persists the latest score", async () => {
		const { app, store } = makeEvalApp(new EvalProvider());
		await seedEval(store);

		const res = await app.request("/eval-runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", evalId: "quality" }),
		});

		expect(res.status).toBe(201);
		const started = (await res.json()) as { id: string; status: string };
		expect(started.status).toBe("running");

		const completed = await waitForEvalRun(store, started.id, "completed");
		expect(completed.summary?.overallScore).toBe(1);

		const latest = await store.forUser("u1").getEvalLatestScore({
			evalId: "quality",
			evalVersion: completed.evalVersion,
			datasetId: "cases",
			datasetVersion: completed.datasetVersion,
			resolvedAgentVersion: "2026-01-01T00:00:00.000Z",
		});
		expect(latest?.runId).toBe(started.id);
		expect(latest?.overallScore).toBe(1);
	});

	it("cancels a running eval and marks pending cases cancelled", async () => {
		const provider = new EvalProvider({ delayMs: 50 });
		const { app, store } = makeEvalApp(provider);
		await seedEval(store);

		const startRes = await app.request("/eval-runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", evalId: "quality" }),
		});
		const started = (await startRes.json()) as { id: string };

		const cancelRes = await app.request(`/eval-runs/${started.id}/cancel`, {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1" }),
		});
		expect(cancelRes.status).toBe(200);
		const cancelled = (await cancelRes.json()) as {
			status: string;
			caseResults: Array<{ status: string }>;
		};
		expect(cancelled.status).toBe("cancelled");
		expect(
			cancelled.caseResults.every((result) => result.status === "cancelled"),
		).toBe(true);
	});
});

function makeEvalApp(provider: ModelProvider) {
	const store = new MemoryStore();
	const manifest: AgentManifest = {
		id: "support",
		kind: "llm",
		instruction: "Answer support questions.",
		model: { provider: "test", name: "target" },
	};
	const app = createWorkerAPI({
		store,
		internalSecret: SECRET,
		resolveRunnerAndManifest: async () => {
			const runner = createRunner({
				store: new MemoryStore(),
				modelProvider: provider,
			});
			runner.registerAgent({
				id: "support",
				name: "Support",
				systemPrompt: "Answer support questions.",
				model: { provider: "test", name: "target" },
				createdAt: "2026-01-01T00:00:00.000Z",
			});
			return { runner, manifest };
		},
	});
	return { app, store };
}

async function seedEval(store: MemoryStore) {
	const scoped = store.forUser("u1");
	await scoped.putEval({
		id: "quality",
		agentId: "support",
		name: "Quality",
		defaultDataset: { id: "cases" },
		passPolicy: { minimumScore: 0.7 },
		criteria: [
			{ id: "accuracy", name: "Accuracy", rubric: "Score correctness." },
		],
	});
	await scoped.putDataset({
		id: "cases",
		agentId: "support",
		name: "Cases",
		items: [
			{ id: "case_001", input: "refund?", name: "Refund question" },
			{ id: "case_002", input: "shipping?", name: "Shipping question" },
		],
	});
}

async function waitForEvalRun(
	store: MemoryStore,
	runId: string,
	status: string,
) {
	for (let i = 0; i < 20; i++) {
		const run = await store.forUser("u1").getEvalRun(runId);
		if (run?.status === status) return run;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for ${status}`);
}

class EvalProvider implements ModelProvider {
	constructor(private readonly opts: { delayMs?: number } = {}) {}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		if (this.opts.delayMs) await delay(this.opts.delayMs, options.signal);
		if (options.outputSchema) {
			return {
				text: JSON.stringify({
					score: 1,
					reason: "matches",
				}),
				usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
				finishReason: "stop",
			};
		}
		return {
			text: "30 days",
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
			finishReason: "stop",
		};
	}
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		if (!signal) return;
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(new Error("aborted"));
			},
			{ once: true },
		);
	});
}
