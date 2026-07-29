import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
	Run,
	ToolContext,
} from "@agntz/core";
import { MemoryStore } from "@agntz/stores/memory";
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
		const next =
			this.responses[this.calls.length - 1] ??
			this.responses[this.responses.length - 1];
		return next;
	}
}

class FailingRunStore extends MemoryStore {
	override putRun(_run: Run): Promise<void> {
		return Promise.reject(new Error("run persistence failed"));
	}
}

function plainResponse(text: string): GenerateTextResult {
	return {
		text,
		usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		finishReason: "stop",
	};
}

// Fixture dir contains two agents — one of which references a local `add`
// tool. Tests that don't specifically exercise tool wiring still need to
// register a noop `add` handler so load doesn't fail on the missing name.
const noopTools = [
	tool({
		name: "add",
		description: "Adds two numbers",
		input: z.object({ a: z.number(), b: z.number() }),
		execute: async () => 0,
	}),
];

describe("agntz() — embedded client", () => {
	it("runs a basic LLM agent end-to-end", async () => {
		const provider = new MockModelProvider([plainResponse("hello back")]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});

		const result = await client.agents.run({ agentId: "echo", input: "hello" });
		expect(result.output).toBe("hello back");
		expect(result.sessionId).toBeTypeOf("string");
		expect(result.sessionId.length).toBeGreaterThan(0);
		expect(provider.calls).toHaveLength(1);
	});

	it("exposes the parsed manifests for introspection", async () => {
		const provider = new MockModelProvider([plainResponse("ok")]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});
		expect(client.manifests.has("echo")).toBe(true);
		expect(client.manifests.get("echo")?.kind).toBe("llm");
	});

	it("calls a registered local tool when the YAML references it", async () => {
		const seenContexts: Array<string[] | undefined> = [];
		const addHandler = vi.fn(
			async ({ a, b }: { a: number; b: number }, ctx: ToolContext) => {
				seenContexts.push(ctx.context);
				return a + b;
			},
		);
		const provider = new MockModelProvider([
			{
				text: "",
				toolCalls: [{ id: "tc_1", name: "add", args: { a: 2, b: 3 } }],
				usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
				finishReason: "tool-calls",
			},
			plainResponse("The answer is 5."),
		]);
		const client = await agntz({
			agents: fixturesDir,
			tools: [
				tool({
					name: "add",
					description: "Adds two numbers",
					input: z.object({ a: z.number(), b: z.number() }),
					execute: addHandler,
				}),
			],
			modelProvider: provider,
		});

		const result = await client.agents.run({
			agentId: "calc-agent",
			input: "what's 2 + 3?",
			context: ["app/user/u_123"],
		});
		expect(addHandler).toHaveBeenCalledOnce();
		expect(addHandler.mock.calls[0][0]).toEqual({ a: 2, b: 3 });
		expect(seenContexts[0]).toEqual(["app/user/u_123"]);
		expect(result.output).toBe("The answer is 5.");
	});

	it("throws at init when a YAML references a local tool that isn't registered", async () => {
		const provider = new MockModelProvider([plainResponse("ok")]);
		await expect(
			agntz({ agents: fixturesDir, modelProvider: provider }),
		).rejects.toThrow(
			/references local tool 'add' but no handler was registered/,
		);
	});

	it("streams complete + reply events for SDK-shape consumers", async () => {
		const provider = new MockModelProvider([plainResponse("streamed answer")]);
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: provider,
		});

		const events: Array<{ type: string }> = [];
		for await (const event of client.agents.stream({
			agentId: "echo",
			input: "hi",
		})) {
			events.push({ type: event.type });
		}
		expect(events.some((e) => e.type === "complete")).toBe(true);
	});

	it("removes caller abort listeners after a completed run", async () => {
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: new MockModelProvider([plainResponse("done")]),
		});
		const controller = new AbortController();
		const add = vi.spyOn(controller.signal, "addEventListener");
		const remove = vi.spyOn(controller.signal, "removeEventListener");

		await client.agents.run({
			agentId: "echo",
			input: "hello",
			signal: controller.signal,
		});

		expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
			once: true,
		});
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		await client.close();
	});

	it("surfaces an earlier durable run-write failure during close", async () => {
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			modelProvider: new MockModelProvider([plainResponse("done")]),
			store: new FailingRunStore(),
		});

		await client.agents.run({ agentId: "echo", input: "hello" });
		await expect(client.close()).rejects.toThrow("run persistence failed");
	});
});
