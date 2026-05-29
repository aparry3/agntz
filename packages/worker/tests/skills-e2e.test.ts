import {
	type GenerateTextOptions,
	type GenerateTextResult,
	MemoryStore,
	type ModelProvider,
	createRunner,
	defineAgent,
	defineTool,
} from "@agntz/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { wrapWithSkillRedaction } from "../src/session-redact.js";

/**
 * End-to-end smoke test mirroring the worker's runtime composition:
 *   store (MemoryStore.forUser) -> wrapWithSkillRedaction -> createRunner.
 *
 * Verifies the integration path that `routes.ts:resolveRunnerAndManifest`
 * builds at request time. Uses a stubbed ModelProvider so no network is
 * required.
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

describe("worker skills e2e (runner + skill redaction)", () => {
	it("after a run completes, the persisted session has the redacted use_skill output", async () => {
		// Three-turn dialog: use_skill -> web_search -> final text
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
					{ id: "tu_2", name: "web_search", args: { q: "agentic ai" } },
				],
				usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
				finishReason: "tool-calls",
			},
			{
				text: "Here's the final answer.",
				usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
				finishReason: "stop",
			},
		]);

		const webSearch = defineTool({
			name: "web_search",
			description: "Search the web.",
			input: z.object({ q: z.string() }),
			async execute(input) {
				return { results: [`hit for ${(input as { q: string }).q}`] };
			},
		});

		// Set up the same store + wrap composition the worker uses.
		const admin = new MemoryStore();
		const userStore = admin.forUser("u1");
		await userStore.putSkill({
			name: "researcher",
			description: "Web research with citation.",
			instructions:
				"search broadly and cite. This is sensitive content that must be redacted.",
			tools: [{ type: "inline", name: "web_search" }],
		});

		// Wrap with skill redaction — same proxy the worker installs.
		const wrapped = wrapWithSkillRedaction(userStore);

		const runner = createRunner({
			modelProvider: provider,
			store: wrapped,
			tools: [webSearch],
		});

		// Register the agent so `invoke()` can find it.
		runner.registerAgent(
			defineAgent({
				id: "researcher-bot",
				name: "Researcher Bot",
				systemPrompt: "You are a researcher.",
				model: { provider: "openai", name: "gpt-5.4" },
				skills: ["researcher"],
			}),
		);

		const sessionId = "sess-e2e-1";
		const result = await runner.invoke(
			"researcher-bot",
			"Tell me about agentic AI.",
			{
				sessionId,
				userId: "u1",
			},
		);

		// ─── Run completed successfully ─────────────────────────────────
		expect(result.output).toBe("Here's the final answer.");
		expect(result.toolCalls).toHaveLength(2);
		expect(result.toolCalls.map((c) => c.name)).toEqual([
			"use_skill",
			"web_search",
		]);

		// ─── Persisted session is REDACTED ──────────────────────────────
		const persistedMessages = await userStore.getMessages(sessionId);
		expect(persistedMessages.length).toBeGreaterThan(0);

		// Find the assistant message carrying the tool calls.
		const assistantMsg = persistedMessages.find(
			(m) =>
				m.role === "assistant" &&
				Array.isArray(m.toolCalls) &&
				m.toolCalls.length > 0,
		);
		expect(assistantMsg).toBeDefined();
		const useSkillCall = assistantMsg?.toolCalls?.find(
			(tc) => tc.name === "use_skill",
		);
		expect(useSkillCall).toBeDefined();

		// The use_skill result's instructions should be replaced with the placeholder.
		const output = useSkillCall?.output as {
			name: string;
			description: string;
			instructions: string;
		};
		expect(output.name).toBe("researcher");
		expect(output.description).toBe("Web research with citation.");
		expect(output.instructions).toBe(
			"[skill 'researcher' was loaded earlier — call use_skill('researcher') to re-load]",
		);
		// The raw instructions text never leaks into persistence.
		expect(JSON.stringify(persistedMessages)).not.toContain(
			"sensitive content that must be redacted",
		);

		// Other tool call is preserved with its original output.
		const webSearchCall = assistantMsg?.toolCalls?.find(
			(tc) => tc.name === "web_search",
		);
		expect(webSearchCall).toBeDefined();
		expect(webSearchCall?.output).toEqual({ results: ["hit for agentic ai"] });
	});
});
