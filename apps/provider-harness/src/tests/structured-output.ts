import type { TestDefinition } from "../types.js";
import { modelConfig, provider } from "./_helpers.js";

export const structuredOutput: TestDefinition = {
	id: "structured-output",
	capability: "structuredOutput",
	timeoutMs: 60_000,
	async run(model, ctx) {
		const result = await provider.generateText({
			model: modelConfig(model),
			messages: [
				// The literal word "json" is required by some providers (e.g. Qwen,
				// OpenAI-compatible json_object mode) to enable structured output.
				{
					role: "user",
					content:
						"Return a person record for Alice, who is 30 years old, as JSON.",
				},
			],
			outputSchema: {
				name: "person",
				schema: {
					type: "object",
					properties: {
						name: { type: "string" },
						age: { type: "number" },
					},
					required: ["name", "age"],
					additionalProperties: false,
				},
			},
			maxTokens: 256,
			signal: ctx.abortSignal,
		});

		if (typeof result.text !== "string" || result.text.trim().length === 0) {
			return { ok: false, reason: "no text returned for structured output" };
		}
		const parsed = extractJson(result.text);
		if (parsed === undefined) {
			return {
				ok: false,
				reason: `output is not valid JSON: ${result.text.slice(0, 120)}`,
			};
		}
		if (typeof parsed !== "object" || parsed === null) {
			return {
				ok: false,
				reason: `expected a JSON object, got ${typeof parsed}`,
			};
		}
		const obj = parsed as Record<string, unknown>;
		if (typeof obj.name !== "string" || typeof obj.age !== "number") {
			return {
				ok: false,
				reason: `schema not satisfied: ${JSON.stringify(parsed).slice(0, 120)}`,
			};
		}
		return { ok: true };
	},
};

// Some providers (notably Gemini) wrap structured output in prose or a markdown
// fence instead of returning raw JSON. Try direct parse, then a fenced block,
// then the first balanced {...} span.
function extractJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		// fall through
	}
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) {
		try {
			return JSON.parse(fence[1].trim());
		} catch {
			// fall through
		}
	}
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start !== -1 && end > start) {
		try {
			return JSON.parse(text.slice(start, end + 1));
		} catch {
			// fall through
		}
	}
	return undefined;
}
