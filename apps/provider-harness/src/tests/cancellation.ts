import type { TestDefinition } from "../types.js";
import {
	consumeStream,
	isAbortError,
	modelConfig,
	provider,
} from "./_helpers.js";

export const cancellation: TestDefinition = {
	id: "cancellation",
	capability: "cancellation",
	timeoutMs: 30_000,
	async run(model, _ctx) {
		// Use our own controller (not the harness timeout) so we can abort the
		// stream deliberately. A long prompt + large budget ensures generation is
		// still in flight when we abort.
		const controller = new AbortController();
		const stream = await provider.streamText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content:
						"Write a detailed 800-word essay on the history of the ocean.",
				},
			],
			maxTokens: 2048,
			signal: controller.signal,
		});

		controller.abort();

		const consumed = await consumeStream(stream);

		// Cancellation respected if the stream surfaced an abort error, or it
		// stopped without producing a full completion.
		if (consumed.streamError && isAbortError(consumed.streamError)) {
			return { ok: true };
		}
		if (consumed.text.trim().length === 0) {
			return { ok: true };
		}
		return {
			ok: false,
			reason: `abort not respected: ${consumed.text.length} chars streamed, error=${consumed.streamError?.name ?? "none"}`,
		};
	},
};
