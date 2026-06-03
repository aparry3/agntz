import { isMissingCredentials } from "../bucket.js";
import type { TestDefinition } from "../types.js";
import { modelConfig } from "./_helpers.js";

export const invalidKey: TestDefinition = {
	id: "invalid-api-key",
	capability: "text",
	async run(model, ctx) {
		try {
			await ctx.adapter.generateText({
				model: modelConfig(model),
				messages: [{ role: "user", content: "Hi" }],
				maxTokens: 16,
				signal: ctx.abortSignal,
				invalidApiKey: true,
			});
			return {
				ok: false,
				reason:
					"expected an auth error with an invalid key, but the call succeeded",
			};
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			// Success = a typed, recognizable auth error, not a generic crash.
			if (
				isMissingCredentials(e) ||
				/\b401\b|\b403\b|unauthorized|forbidden|invalid|api[\s_-]?key|authentication/i.test(
					e.message,
				)
			) {
				return { ok: true };
			}
			return {
				ok: false,
				reason: `expected a typed auth error, got ${e.name}: ${e.message.slice(0, 120)}`,
			};
		}
	},
};
