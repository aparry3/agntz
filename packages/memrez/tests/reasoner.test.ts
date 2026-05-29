import { describe, expect, it } from "vitest";
import { agntzReasoner } from "../src/index.js";
import type { AgntzClientLike, AgntzRunResult } from "../src/index.js";

describe("agntzReasoner", () => {
	it("runs the tagger agent and parses object output", async () => {
		const calls: unknown[] = [];
		const reasoner = agntzReasoner({
			client: fakeClient(calls, {
				output: {
					namespace: "app/user/u_123",
					topics: ["prefs"],
					type: "preference",
					normalizedContent: "Prefers metric units.",
				},
				state: {},
				sessionId: "s1",
			}),
		});

		const result = await reasoner.tag({
			grants: ["app/user/u_123"],
			content: "metric please",
			existingTopics: [],
			writePolicy: { descendants: true, ancestorPromotion: "none" },
		});

		expect(calls[0]).toMatchObject({
			agentId: "memrez-tagger",
			input: {
				grants: ["app/user/u_123"],
				content: "metric please",
			},
		});
		expect(result).toEqual({
			namespace: "app/user/u_123",
			topics: ["prefs"],
			type: "preference",
			normalizedContent: "Prefers metric units.",
			duplicateOf: undefined,
		});
	});

	it("runs the curator agent and parses JSON string output", async () => {
		const calls: unknown[] = [];
		const reasoner = agntzReasoner({
			client: fakeClient(calls, {
				output: JSON.stringify({
					ops: [
						{
							type: "setBlurb",
							scope: "app/user/u_123",
							topic: "prefs",
							blurb: "Preferences.",
						},
					],
				}),
				state: {},
				sessionId: "s1",
			}),
		});

		const ops = await reasoner.curate?.({
			grants: ["app/user/u_123"],
			scopePaths: ["app", "app/user", "app/user/u_123"],
			entries: [],
		});

		expect(calls[0]).toMatchObject({
			agentId: "memrez-curator",
			input: {
				grants: ["app/user/u_123"],
			},
		});
		expect(ops).toEqual([
			{
				type: "setBlurb",
				scope: "app/user/u_123",
				topic: "prefs",
				blurb: "Preferences.",
			},
		]);
	});
});

function fakeClient(calls: unknown[], result: AgntzRunResult): AgntzClientLike {
	return {
		agents: {
			async run(input) {
				calls.push(input);
				return result;
			},
			async *stream() {
				// unused
			},
		},
	};
}
