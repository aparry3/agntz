import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent.js";
import { createRunner } from "../src/runner.js";
import { MemoryStore } from "../src/stores/memory.js";
import { defineTool } from "../src/tool.js";
import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "../src/types.js";

/**
 * Deterministic model provider. Returns each entry of `responses` in order;
 * stores every received options object for later inspection.
 */
class MockModelProvider implements ModelProvider {
	private responses: GenerateTextResult[];
	private callIndex = 0;
	public calls: GenerateTextOptions[] = [];

	constructor(responses: GenerateTextResult[]) {
		this.responses = responses;
	}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		this.calls.push(options);
		const r =
			this.responses[this.callIndex] ??
			this.responses[this.responses.length - 1];
		this.callIndex++;
		return r;
	}
}

describe("Runner integration with skills", () => {
	it("registers use_skill on turn 0, then skill tools after loading, and the system prompt advertises skills", async () => {
		// Three-turn conversation:
		//   turn 0 → model wants to use_skill("researcher")
		//   turn 1 → model wants to call the skill-provided web_search tool
		//   turn 2 → model emits final text
		const provider = new MockModelProvider([
			{
				text: "",
				toolCalls: [
					{ id: "tu_1", name: "use_skill", args: { skill: "researcher" } },
				],
				usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
				finishReason: "tool-calls",
			},
			{
				text: "",
				toolCalls: [{ id: "tu_2", name: "web_search", args: { q: "test" } }],
				usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
				finishReason: "tool-calls",
			},
			{
				text: "All done.",
				usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
				finishReason: "stop",
			},
		]);

		// Inline web_search tool that the researcher skill brings in.
		const webSearch = defineTool({
			name: "web_search",
			description: "Search the web.",
			input: z.object({ q: z.string() }),
			async execute(input) {
				return { results: [`hit for ${(input as { q: string }).q}`] };
			},
		});

		// Backend store. Put a skill named "researcher" under user "u1".
		const adminStore = new MemoryStore();
		const userStore = adminStore.forUser("u1");
		await userStore.putSkill({
			name: "researcher",
			description: "web research with citation",
			instructions: "search broadly",
			tools: [{ type: "inline", name: "web_search" }],
		});

		// Build the runner. Pass the user-scoped store so skills resolve.
		const runner = createRunner({
			modelProvider: provider,
			store: userStore,
			tools: [webSearch],
		});

		// Register an agent that declares skills: ["researcher"].
		runner.registerAgent(
			defineAgent({
				id: "test-agent",
				name: "Test",
				systemPrompt: "You are a test agent.",
				model: { provider: "openai", name: "gpt-5.4" },
				skills: ["researcher"],
			}),
		);

		const result = await runner.invoke("test-agent", "Help me research X.", {
			userId: "u1",
		});

		// ─── Three model calls happened ─────────────────────────────────
		expect(provider.calls).toHaveLength(3);

		// ─── Turn 0: use_skill is registered, web_search is NOT yet ───
		const turn0 = provider.calls[0];
		expect(turn0.tools).toBeDefined();
		const turn0ToolNames = (turn0.tools ?? []).map((t) => t.name);
		expect(turn0ToolNames).toContain("use_skill");
		expect(turn0ToolNames).not.toContain("web_search");

		// ─── Turn 1: web_search is now registered, use_skill still there ──
		const turn1 = provider.calls[1];
		expect(turn1.tools).toBeDefined();
		const turn1ToolNames = (turn1.tools ?? []).map((t) => t.name);
		expect(turn1ToolNames).toContain("use_skill");
		expect(turn1ToolNames).toContain("web_search");

		// ─── Final result captured both tool calls ──────────────────────
		expect(result.toolCalls).toHaveLength(2);
		const callNames = result.toolCalls.map((c) => c.name);
		expect(callNames).toEqual(["use_skill", "web_search"]);
		expect(result.output).toBe("All done.");

		// ─── System prompt augmentation ────────────────────────────────
		// The first system message should list "researcher: web research with citation"
		// but NOT the full instructions ("search broadly").
		const systemMessage = turn0.messages.find((m) => m.role === "system");
		expect(systemMessage).toBeDefined();
		const sys = systemMessage?.content;
		expect(sys).toContain("researcher");
		expect(sys).toContain("web research with citation");
		// The system prompt must not leak the skill's instructions.
		expect(sys).not.toContain("search broadly");
	});

	it("the same skill is loaded only once across multiple use_skill calls in a single run", async () => {
		// Model tries to load "researcher" twice in a row, then emits text.
		const provider = new MockModelProvider([
			{
				text: "",
				toolCalls: [
					{ id: "tu_1", name: "use_skill", args: { skill: "researcher" } },
				],
				usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
				finishReason: "tool-calls",
			},
			{
				text: "",
				toolCalls: [
					{ id: "tu_2", name: "use_skill", args: { skill: "researcher" } },
				],
				usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
				finishReason: "tool-calls",
			},
			{
				text: "ok",
				usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
				finishReason: "stop",
			},
		]);

		const webSearch = defineTool({
			name: "web_search",
			description: "Search the web.",
			input: z.object({ q: z.string() }),
			async execute() {
				return { results: [] };
			},
		});

		const adminStore = new MemoryStore();
		const userStore = adminStore.forUser("u1");
		await userStore.putSkill({
			name: "researcher",
			description: "web research",
			instructions: "search broadly",
			tools: [{ type: "inline", name: "web_search" }],
		});

		const runner = createRunner({
			modelProvider: provider,
			store: userStore,
			tools: [webSearch],
		});

		runner.registerAgent(
			defineAgent({
				id: "test-agent",
				name: "Test",
				systemPrompt: "You are a test agent.",
				model: { provider: "openai", name: "gpt-5.4" },
				skills: ["researcher"],
			}),
		);

		const result = await runner.invoke("test-agent", "Help.", { userId: "u1" });

		// Two use_skill calls captured.
		expect(result.toolCalls).toHaveLength(2);
		expect(result.toolCalls[0].name).toBe("use_skill");
		expect(result.toolCalls[1].name).toBe("use_skill");

		// The second call returns alreadyLoaded.
		expect(result.toolCalls[1].output).toMatchObject({
			alreadyLoaded: true,
			name: "researcher",
		});
	});
});
