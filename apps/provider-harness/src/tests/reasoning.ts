import type { TestDefinition } from "../types.js";

export const reasoning: TestDefinition = {
	id: "reasoning",
	capability: "reasoning",
	async run() {
		// core's TokenUsage exposes only prompt/completion/total tokens (+ cost) —
		// there is no reasoning/thinking-token field to assert against. Verifying
		// the reasoning capability properly needs a core change to surface those.
		// Self-skip with that reason so the gap is visible in every report.
		return {
			ok: true,
			skip: "core TokenUsage exposes no reasoning-token field; needs a core change to verify",
		};
	},
};
