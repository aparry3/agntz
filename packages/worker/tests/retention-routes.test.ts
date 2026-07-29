import {
	type GenerateTextOptions,
	type GenerateTextResult,
	type ModelProvider,
	createRunner,
} from "@agntz/core";
import type { LLMAgentManifest } from "@agntz/core/manifest";
import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

class FixedProvider implements ModelProvider {
	async generateText(
		_options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		return {
			text: "classified",
			usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
			finishReason: "stop",
			model: "resolved-model",
			provider: "test-provider",
			responseId: "response_123",
		};
	}
}

function setup(manifestRetention?: LLMAgentManifest["retention"]) {
	const store = new MemoryStore();
	const manifest: LLMAgentManifest = {
		kind: "llm",
		id: "classifier",
		instruction: "Classify",
		model: { provider: "test-provider", name: "requested-model" },
		retention: manifestRetention,
	};
	const app = createWorkerAPI({
		store,
		internalSecret: "test-secret",
		resolveRunnerAndManifest: async (unified, userId) => ({
			runner: createRunner({
				modelProvider: new FixedProvider(),
				store: unified.forUser(userId),
			}),
			manifest,
		}),
	});
	return { app, store };
}

async function apiKey(store: MemoryStore) {
	return (
		await store.forUser("u1").createApiKey({ userId: "u1", name: "test" })
	).rawKey;
}

describe("hosted run retention", () => {
	it("none returns metadata without persisting a run, trace, or session", async () => {
		const { app, store } = setup();
		const key = await apiKey(store);
		const response = await app.request("/run", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				agentId: "classifier",
				input: "private input",
				retention: { mode: "none" },
			}),
		});

		expect(response.status).toBe(200);
		const result = await response.json();
		expect(result).toMatchObject({
			output: "classified",
			status: "completed",
			provider: "test-provider",
			model: "resolved-model",
			finishReason: "stop",
			responseId: "response_123",
			usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
			retention: { mode: "none" },
		});
		expect(result.sessionId).toBeUndefined();
		expect(result.traceId).toBeUndefined();
		expect(await store.forUser("u1").getRun(result.runId)).toBeNull();
		expect(await store.forUser("u1").listSessions()).toEqual([]);
		expect(await store.getSummary(result.runId, "u1")).toBeNull();
	});

	it("result persists only the normalized result envelope", async () => {
		const { app, store } = setup();
		const key = await apiKey(store);
		const response = await app.request("/run", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				agentId: "classifier",
				input: "private input",
				retention: { mode: "result", ttlSeconds: 3600 },
			}),
		});
		const result = await response.json();

		expect(response.status).toBe(200);
		expect(result.sessionId).toBeUndefined();
		expect(result.traceId).toBeUndefined();
		const stored = await store.forUser("u1").getRun(result.runId);
		expect(stored).toMatchObject({
			id: result.runId,
			input: "",
			retentionMode: "result",
			sessionId: undefined,
			result: {
				output: "classified",
				toolCalls: [],
				model: "resolved-model",
			},
		});
		expect(stored?.expiresAt).toBeDefined();
		expect(await store.forUser("u1").listSessions()).toEqual([]);
		expect(await store.getSummary(result.runId, "u1")).toBeNull();
	});

	it("rejects none for durable starts and prevents loosening manifest defaults", async () => {
		const { app, store } = setup({ mode: "none" });
		const key = await apiKey(store);
		const headers = {
			Authorization: `Bearer ${key}`,
			"Content-Type": "application/json",
		};

		const durable = await app.request("/runs", {
			method: "POST",
			headers,
			body: JSON.stringify({
				agentId: "classifier",
				retention: { mode: "none" },
			}),
		});
		expect(durable.status).toBe(400);

		const loosened = await app.request("/run", {
			method: "POST",
			headers,
			body: JSON.stringify({
				agentId: "classifier",
				retention: { mode: "session" },
			}),
		});
		expect(loosened.status).toBe(400);
		expect((await loosened.json()).error).toContain("less strict");
	});
});
