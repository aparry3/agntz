import { createRunner, defineAgent } from "@agntz/core";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { describe, expect, it } from "vitest";
import { createMemrez } from "../src/index.js";
import type {
	MemrezReasoner,
	TaggerInput,
	TaggerResult,
} from "../src/index.js";

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

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

describe("memrez resource provider", () => {
	it("registers memory_read and memory_write and injects autoScan context", async () => {
		const memrez = createMemrez({ reasoner: new DirectiveReasoner() });
		await memrez.write(["app/user/u_123"], "topic:prefs|Prefers metric units.");

		const model = new MockModelProvider([
			{
				text: "",
				toolCalls: [
					{ id: "tc_1", name: "memory_read", args: { topic: "prefs" } },
				],
				usage,
				finishReason: "tool-calls",
			},
			{ text: "done", usage, finishReason: "stop" },
		]);
		const runner = createRunner({
			modelProvider: model,
			resources: { memory: memrez.provider() },
		});
		runner.registerAgent(
			defineAgent({
				id: "support",
				name: "Support",
				systemPrompt: "Use memory when useful.",
				model: { provider: "openai", name: "test" },
				resources: {
					memory: { kind: "memory", mode: "read-write", autoScan: true },
				},
			}),
		);

		const result = await runner.invoke("support", "what do you know?", {
			context: ["app/user/u_123"],
		});

		expect(model.calls[0].tools?.map((tool) => tool.name).sort()).toEqual([
			"memory_read",
			"memory_write",
		]);
		expect(
			model.calls[0].messages.some(
				(message) =>
					message.role === "system" &&
					message.content.includes("Memory topics visible to this run") &&
					message.content.includes("prefs (1)"),
			),
		).toBe(true);
		expect(result.toolCalls[0].output).toMatchObject([
			{
				scope: "app/user/u_123",
				content: "Prefers metric units.",
				topics: ["prefs"],
			},
		]);
	});

	it("omits memory_write when the resource mode is read-only", async () => {
		const memrez = createMemrez({ reasoner: new DirectiveReasoner() });
		const model = new MockModelProvider([
			{ text: "done", usage, finishReason: "stop" },
		]);
		const runner = createRunner({
			modelProvider: model,
			resources: { memory: memrez.provider() },
		});
		runner.registerAgent(
			defineAgent({
				id: "reader",
				name: "Reader",
				systemPrompt: "Read only.",
				model: { provider: "openai", name: "test" },
				resources: {
					memory: { kind: "memory", mode: "read" },
				},
			}),
		);

		await runner.invoke("reader", "go", { context: ["app/user/u_123"] });

		expect(model.calls[0].tools?.map((tool) => tool.name)).toEqual([
			"memory_read",
		]);
	});

	it("writes through memory_write using the run grants and provider write policy", async () => {
		const memrez = createMemrez({ reasoner: new DirectiveReasoner() });
		const model = new MockModelProvider([
			{
				text: "",
				toolCalls: [
					{
						id: "tc_1",
						name: "memory_write",
						args: {
							content: "topic:prefs|Prefers email.",
							type: "preference",
						},
					},
				],
				usage,
				finishReason: "tool-calls",
			},
			{ text: "done", usage, finishReason: "stop" },
		]);
		const runner = createRunner({
			modelProvider: model,
			resources: { memory: memrez.provider() },
		});
		runner.registerAgent(
			defineAgent({
				id: "writer",
				name: "Writer",
				systemPrompt: "Write memory.",
				model: { provider: "openai", name: "test" },
				resources: {
					memory: {
						kind: "memory",
						mode: "read-write",
						writePolicy: { descendants: true, ancestorPromotion: "none" },
					},
				},
			}),
		);

		const result = await runner.invoke("writer", "remember this", {
			context: ["app/user/u_123"],
			runId: "run_1",
			sessionId: "ses_1",
		});
		const entries = await memrez.read(["app/user/u_123"], "prefs");

		expect(result.toolCalls[0].output).toMatchObject({
			action: "appended",
			entry: {
				scope: "app/user/u_123",
				source: { agentId: "writer", sessionId: "ses_1", runId: "run_1" },
			},
		});
		expect(entries.map((entry) => entry.content)).toEqual(["Prefers email."]);
	});

	it("reads multiple topics through memory_read in one call", async () => {
		const memrez = createMemrez({ reasoner: new DirectiveReasoner() });
		await memrez.write(["app/user/u_123"], "topic:equipment|Dumbbells only.");
		await memrez.write(["app/user/u_123"], "topic:goals|Strength.");

		const model = new MockModelProvider([
			{
				text: "",
				toolCalls: [
					{
						id: "tc_1",
						name: "memory_read",
						args: { topics: ["equipment", "goals"] },
					},
				],
				usage,
				finishReason: "tool-calls",
			},
			{ text: "done", usage, finishReason: "stop" },
		]);
		const runner = createRunner({
			modelProvider: model,
			resources: { memory: memrez.provider() },
		});
		runner.registerAgent(
			defineAgent({
				id: "multi",
				name: "Multi",
				systemPrompt: "Use memory.",
				model: { provider: "openai", name: "test" },
				resources: { memory: { kind: "memory" } },
			}),
		);

		const result = await runner.invoke("multi", "recall", {
			context: ["app/user/u_123"],
		});

		expect(
			(result.toolCalls[0].output as Array<{ content: string }>).map(
				(entry) => entry.content,
			),
		).toEqual(["Dumbbells only.", "Strength."]);
	});

	it("preloads pinned topics as full entries beneath the topic list", async () => {
		const memrez = createMemrez({ reasoner: new DirectiveReasoner() });
		await memrez.write(
			["app/user/u_123"],
			"topic:equipment,pinned|Dumbbells only.",
		);
		await memrez.write(["app/user/u_123"], "topic:history|Did 30 sessions.");

		const model = new MockModelProvider([
			{ text: "done", usage, finishReason: "stop" },
		]);
		const runner = createRunner({
			modelProvider: model,
			resources: { memory: memrez.provider() },
		});
		runner.registerAgent(
			defineAgent({
				id: "preloader",
				name: "Preloader",
				systemPrompt: "Train.",
				model: { provider: "openai", name: "test" },
				resources: {
					memory: { kind: "memory", preload: ["pinned"] },
				},
			}),
		);

		await runner.invoke("preloader", "go", { context: ["app/user/u_123"] });

		const system = model.calls[0].messages.find(
			(message) => message.role === "system",
		);
		expect(system?.content).toContain("Memory topics visible to this run");
		expect(system?.content).toContain(
			"Preloaded memory entries (most recent first):",
		);
		expect(system?.content).toContain("- [equipment, pinned] Dumbbells only.");
		expect(system?.content).not.toContain("Did 30 sessions.");
	});

	it("preloads all entries except events and respects preloadLimit", async () => {
		const memrez = createMemrez({ reasoner: new DirectiveReasoner() });
		await memrez.write(["app/user/u_123"], "topic:goals|Strength.");
		await memrez.write(["app/user/u_123"], "topic:history|Logged workout.", {
			type: "event",
		});
		// updatedAt has millisecond resolution; step forward so "most recent
		// first" ordering under preloadLimit is deterministic.
		await new Promise((resolve) => setTimeout(resolve, 2));
		await memrez.write(["app/user/u_123"], "topic:equipment|Dumbbells only.");

		const model = new MockModelProvider([
			{ text: "done", usage, finishReason: "stop" },
		]);
		const runner = createRunner({
			modelProvider: model,
			resources: { memory: memrez.provider() },
		});
		runner.registerAgent(
			defineAgent({
				id: "preload-all",
				name: "PreloadAll",
				systemPrompt: "Train.",
				model: { provider: "openai", name: "test" },
				resources: {
					memory: {
						kind: "memory",
						autoScan: false,
						preload: "all",
						preloadLimit: 1,
					},
				},
			}),
		);

		await runner.invoke("preload-all", "go", { context: ["app/user/u_123"] });

		const system = model.calls[0].messages.find(
			(message) => message.role === "system",
		);
		expect(system?.content).not.toContain("Memory topics visible to this run");
		expect(system?.content).toContain("- [equipment] Dumbbells only.");
		expect(system?.content).not.toContain("Logged workout.");
		expect(system?.content).toContain("1 more entries not shown");
	});
});

class DirectiveReasoner implements MemrezReasoner {
	async tag(input: TaggerInput): Promise<TaggerResult> {
		const [prefix, content] = input.content.includes("|")
			? input.content.split("|")
			: ["topic:general", input.content];
		const topics = prefix.startsWith("topic:")
			? prefix.slice("topic:".length).split(",")
			: (input.topicsHint ?? ["general"]);
		return {
			namespace: input.grants[0],
			topics,
			type: "fact",
			normalizedContent: content.trim(),
		};
	}
}
