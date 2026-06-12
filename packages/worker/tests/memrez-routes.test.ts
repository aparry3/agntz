import {
	type GenerateTextOptions,
	type GenerateTextResult,
	MemoryStore,
	type ModelProvider,
	createRunner,
} from "@agntz/core";
import { parseManifest } from "@agntz/manifest";
import { createMemrez } from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

class MockModelProvider implements ModelProvider {
	public calls: GenerateTextOptions[] = [];

	constructor(private readonly responses: GenerateTextResult[]) {}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		this.calls.push(options);
		return (
			this.responses[this.calls.length - 1] ??
			this.responses[this.responses.length - 1]
		);
	}
}

function internalAuthHeaders() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
	} as const;
}

describe("worker memrez integration", () => {
	it("exposes memory tools for a YAML agent and persists writes", async () => {
		const store = new MemoryStore();
		const memrez = createMemrez();
		const modelProvider = new MockModelProvider([
			{
				text: "",
				toolCalls: [
					{
						id: "tc_write",
						name: "memory_write",
						args: {
							content: "Prefers tea.",
							type: "preference",
							topicsHint: ["preferences"],
						},
					},
				],
				usage,
				finishReason: "tool-calls",
			},
			{ text: "remembered", usage, finishReason: "stop" },
		]);
		const manifest = parseManifest(`
id: support
kind: llm
model:
  provider: openai
  name: test
instruction: Use durable memory when useful.
resources:
  memory:
    kind: memory
    mode: read-write
`);
		const app = createWorkerAPI({
			store,
			internalSecret: SECRET,
			resolveRunnerAndManifest: async () => {
				const runner = createRunner({
					store: new MemoryStore(),
					modelProvider,
					resources: { memory: memrez.provider() },
				});
				return { runner, manifest };
			},
		});

		const res = await app.request("/run", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "support",
				input: "remember my preference",
				context: ["app/user/u1"],
			}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { output: string };
		expect(body.output).toBe("remembered");
		expect(
			modelProvider.calls[0].tools?.map((tool) => tool.name).sort(),
		).toEqual(["memory_read", "memory_write"]);

		const entries = await memrez.read(["app/user/u1"], "preferences");
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			content: "Prefers tea.",
			scope: "app/user/u1",
			type: "preference",
			topics: ["preferences"],
		});
	});
});
