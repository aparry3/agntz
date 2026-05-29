import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { describe, expect, it } from "vitest";
import { agntz, tool, z } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures/agents");

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

function plainResponse(text: string): GenerateTextResult {
	return {
		text,
		usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		finishReason: "stop",
	};
}

const noopTools = [
	tool({
		name: "add",
		description: "Adds two numbers",
		input: z.object({ a: z.number(), b: z.number() }),
		execute: async () => 0,
	}),
];

describe("agntz() — sequential pipelines", () => {
	it("runs a two-step sequential agent end-to-end", async () => {
		// Step 1 returns JSON (outputSchema applied), step 2 returns plain text.
		const provider = new MockModelProvider([
			plainResponse(
				JSON.stringify({
					summary: "Embedded runners ship five-line quickstarts.",
				}),
			),
			plainResponse("agntz: agents, but five lines."),
		]);

		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});

		const result = await client.agents.run({
			agentId: "pipeline",
			input: { topic: "embedded agent runners" },
		});
		expect(provider.calls).toHaveLength(2);

		const out = result.output as { summary: string; tagline: string };
		expect(out.summary).toContain("Embedded runners ship");
		expect(out.tagline).toContain("five lines");
	});

	it("captures spans for the pipeline + each LLM sub-step", async () => {
		const provider = new MockModelProvider([
			plainResponse(JSON.stringify({ summary: "a" })),
			plainResponse("b"),
		]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});
		await client.agents.run({ agentId: "pipeline", input: { topic: "x" } });

		const { rows } = await client.traces.list();
		expect(rows).toHaveLength(1);
		expect(rows[0].spanCount).toBeGreaterThanOrEqual(3); // manifest + 2 steps minimum

		const detail = await client.traces.get(rows[0].traceId);
		expect(detail).not.toBeNull();
		const kinds = detail?.spans.map((s) => s.kind).sort();
		expect(kinds).toContain("manifest");
		expect(kinds).toContain("step");
	});

	it("falls back to a single 'complete' event on stream() for non-LLM kinds", async () => {
		const provider = new MockModelProvider([
			plainResponse(JSON.stringify({ summary: "x" })),
			plainResponse("y"),
		]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});
		const types: string[] = [];
		for await (const event of client.agents.stream({
			agentId: "pipeline",
			input: { topic: "anything" },
		})) {
			types.push(event.type);
		}
		expect(types).toContain("complete");
	});
});
