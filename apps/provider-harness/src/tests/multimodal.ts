import type { TestDefinition } from "../types.js";
import { assertNonEmptyText, modelConfig } from "./_helpers.js";

// 32×32 solid-red PNG (96 bytes), generated offline. Self-contained so the
// base64 path needs no network and no external fixture.
const RED_PNG_B64 =
	"iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAJ0lEQVR42u3NsQkAAAjAsP7/tF7hIASyp6lTCQQCgUAgEAgEgi/BAjLD/C5w/SM9AAAAAElFTkSuQmCC";
const RED_PNG_DATA_URL = `data:image/png;base64,${RED_PNG_B64}`;

const PROMPT =
	"What is the dominant color of this image? Answer with one word.";

export const multimodalBase64: TestDefinition = {
	id: "multimodal-base64",
	capability: "multimodalImage",
	timeoutMs: 60_000,
	async run(model, ctx) {
		const result = await ctx.adapter.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: PROMPT },
						{ type: "image", image: RED_PNG_DATA_URL },
					],
				},
			],
			maxTokens: 256,
			signal: ctx.abortSignal,
		});
		return assertNonEmptyText(result.text);
	},
};

export const multimodalUrl: TestDefinition = {
	id: "multimodal-url",
	capability: "multimodalImage",
	timeoutMs: 60_000,
	async run(model, ctx) {
		// URL-based image input requires a *publicly reachable* URL (the provider
		// fetches it server-side). Rather than hardcode an external URL that could
		// rot, read it from env and self-skip when unset.
		const url = process.env.HARNESS_IMAGE_URL;
		if (!url) {
			return {
				ok: true,
				skip: "set HARNESS_IMAGE_URL to a public image to test URL-based input",
			};
		}
		const result = await ctx.adapter.generateText({
			model: modelConfig(model),
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: PROMPT },
						{ type: "image", image: url },
					],
				},
			],
			maxTokens: 256,
			signal: ctx.abortSignal,
		});
		return assertNonEmptyText(result.text);
	},
};
