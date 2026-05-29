import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	StreamEvent as CoreStreamEvent,
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { describe, expect, it, vi } from "vitest";
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
		usage: { promptTokens: 2, completionTokens: 4, totalTokens: 6 },
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

describe("LocalClient — runs buffer", () => {
	it("records every successful run and exposes it via runs.list/get", async () => {
		const provider = new MockModelProvider([
			plainResponse("one"),
			plainResponse("two"),
		]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});

		await client.agents.run({ agentId: "echo", input: "first" });
		await client.agents.run({ agentId: "echo", input: "second" });

		const { rows } = await client.runs.list();
		expect(rows).toHaveLength(2);
		// Newest first
		expect(rows[0].input).toBe("second");
		expect(rows[1].input).toBe("first");
		expect(rows[0].status).toBe("completed");
		expect(rows[0].result?.output).toBe("two");

		const fetched = await client.runs.get(rows[0].id);
		expect(fetched?.id).toBe(rows[0].id);
	});

	it("records failed runs with status 'failed' and error message", async () => {
		const provider = new MockModelProvider([plainResponse("never reached")]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});

		await expect(
			client.agents.run({ agentId: "missing-agent", input: "x" }),
		).rejects.toThrow();
		const { rows } = await client.runs.list();
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe("failed");
		expect(rows[0].error).toBeTruthy();
	});

	it("filters runs by agentId and status", async () => {
		const provider = new MockModelProvider([plainResponse("hi")]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});
		await client.agents.run({ agentId: "echo", input: "hello" });

		const matching = await client.runs.list({
			agentId: "echo",
			status: "completed",
		});
		expect(matching.rows).toHaveLength(1);
		const nonMatching = await client.runs.list({
			agentId: "echo",
			status: "failed",
		});
		expect(nonMatching.rows).toHaveLength(0);
	});
});

describe("LocalClient — traces buffer", () => {
	it("records a trace per invocation with hierarchical spans", async () => {
		const provider = new MockModelProvider([
			{
				text: "",
				toolCalls: [{ id: "tc_1", name: "add", args: { a: 1, b: 2 } }],
				usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
				finishReason: "tool-calls",
			},
			plainResponse("Done."),
		]);
		const client = await agntz({
			agents: fixturesDir,
			tools: [
				tool({
					name: "add",
					description: "Adds two numbers",
					input: z.object({ a: z.number(), b: z.number() }),
					execute: async () => 3,
				}),
			],
			modelProvider: provider,
		});

		await client.agents.run({ agentId: "calc-agent", input: "1 + 2?" });

		const { rows } = await client.traces.list();
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe("ok");
		// Manifest executor emits manifest + invoke + (tool) spans.
		expect(rows[0].spanCount).toBeGreaterThanOrEqual(2);

		const detail = await client.traces.get(rows[0].traceId);
		expect(detail).not.toBeNull();
		expect(detail?.spans.length).toBeGreaterThanOrEqual(2);
	});
});

describe("LocalClient — onEvent callback", () => {
	it("fires onEvent for every core stream event during .agents.stream", async () => {
		const provider = new MockModelProvider([plainResponse("streamed")]);
		const seen: CoreStreamEvent[] = [];
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
			onEvent: (e) => seen.push(e),
		});

		for await (const _ of client.agents.stream({
			agentId: "echo",
			input: "hi",
		})) {
			// consume
		}
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.some((e) => e.type === "done")).toBe(true);
	});

	it("does not fire onEvent for non-streaming .agents.run", async () => {
		const provider = new MockModelProvider([plainResponse("ok")]);
		const onEvent = vi.fn();
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
			onEvent,
		});
		await client.agents.run({ agentId: "echo", input: "hi" });
		expect(onEvent).not.toHaveBeenCalled();
	});
});
