import type {
	GenerateTextOptions,
	GenerateTextResult,
	ModelProvider,
} from "@agntz/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_TAGGER_MODEL,
	createMemrez,
	llmReasoner,
} from "../src/index.js";
import type { TaggerInput } from "../src/index.js";

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

class MockModelProvider implements ModelProvider {
	public calls: GenerateTextOptions[] = [];

	constructor(
		private readonly respond: (
			options: GenerateTextOptions,
		) => GenerateTextResult,
	) {}

	async generateText(
		options: GenerateTextOptions,
	): Promise<GenerateTextResult> {
		this.calls.push(options);
		return this.respond(options);
	}
}

function jsonResult(value: unknown): GenerateTextResult {
	return { text: JSON.stringify(value), usage, finishReason: "stop" };
}

function taggerInput(content: string): TaggerInput {
	return {
		grants: ["app/user/u_1"],
		content,
		existingTopics: ["prefs"],
		writePolicy: { descendants: true, ancestorPromotion: "none" },
	};
}

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("llmReasoner", () => {
	it("tags via a direct structured model call", async () => {
		const provider = new MockModelProvider(() =>
			jsonResult({
				namespace: "app/user/u_1",
				topics: ["equipment", "pinned"],
				type: "preference",
				normalizedContent: "Has dumbbells only.",
				duplicateOf: null,
			}),
		);
		const reasoner = llmReasoner({ modelProvider: provider });

		const result = await reasoner.tag(
			taggerInput("I only have dumbbells at home"),
		);

		expect(result).toEqual({
			namespace: "app/user/u_1",
			topics: ["equipment", "pinned"],
			type: "preference",
			normalizedContent: "Has dumbbells only.",
			duplicateOf: undefined,
		});
		expect(provider.calls[0].model).toEqual(DEFAULT_TAGGER_MODEL);
		expect(provider.calls[0].outputSchema?.name).toBe("memrez_tag");
		const userMessage = provider.calls[0].messages.find(
			(message) => message.role === "user",
		);
		expect(userMessage?.content).toContain("I only have dumbbells at home");
		expect(userMessage?.content).toContain('["app/user/u_1"]');
	});

	it("falls back to deterministic tagging when the model call fails", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const provider = new MockModelProvider(() => {
			throw new Error("provider outage");
		});
		const reasoner = llmReasoner({ modelProvider: provider });

		const result = await reasoner.tag({
			...taggerInput("Remember this"),
			topicsHint: ["prefs"],
		});

		expect(result).toEqual({
			namespace: "app/user/u_1",
			topics: ["prefs"],
			type: "fact",
			normalizedContent: "Remember this",
		});
		expect(warn).toHaveBeenCalledOnce();
	});

	it("throws a loud setup error when the env key is missing", async () => {
		vi.stubEnv("OPENAI_API_KEY", "");
		const reasoner = llmReasoner();

		await expect(reasoner.tag(taggerInput("anything"))).rejects.toThrow(
			/OPENAI_API_KEY/,
		);
	});

	it("curates via a direct structured model call and propagates failures", async () => {
		const provider = new MockModelProvider(() =>
			jsonResult({
				ops: [
					{
						type: "setBlurb",
						scope: "app/user/u_1",
						topic: "prefs",
						blurb: "Communication preferences.",
					},
				],
			}),
		);
		const reasoner = llmReasoner({ modelProvider: provider });

		const ops = await reasoner.curate?.({
			grants: ["app/user/u_1"],
			scopePaths: ["app", "app/user", "app/user/u_1"],
			entries: [],
		});
		expect(ops).toEqual([
			{
				type: "setBlurb",
				scope: "app/user/u_1",
				topic: "prefs",
				blurb: "Communication preferences.",
			},
		]);

		const failing = llmReasoner({
			modelProvider: new MockModelProvider(() => {
				throw new Error("curator outage");
			}),
		});
		await expect(
			failing.curate?.({
				grants: ["app/user/u_1"],
				scopePaths: ["app/user/u_1"],
				entries: [],
			}),
		).rejects.toThrow(/curator outage/);
	});

	it("is the createMemrez default and is curate-capable", () => {
		const memrez = createMemrez();
		expect(typeof memrez.reasoner.tag).toBe("function");
		expect(typeof memrez.reasoner.curate).toBe("function");
	});
});
