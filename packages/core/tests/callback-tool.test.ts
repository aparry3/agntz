import type { SecretStore } from "@agntz/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	CALLBACK_DELIVERY_ID_HEADER,
	CALLBACK_IDEMPOTENCY_HEADER,
	CALLBACK_SIGNATURE_HEADER,
	CALLBACK_TIMESTAMP_HEADER,
	buildCallbackToolDefinition,
	signCallback,
} from "../src/callback-tool.js";

describe("callback tools", () => {
	it("advertises the exact typed schema and signs trusted runtime context", async () => {
		const inputSchema = {
			type: "object",
			properties: {
				tags: { type: "array", items: { type: "string" } },
				limit: { type: "integer", minimum: 1 },
			},
			required: ["tags"],
			additionalProperties: false,
		};
		const calls: Array<{ headers: Headers; body: string }> = [];
		const fetchMock = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				calls.push({
					headers: new Headers(init?.headers),
					body: String(init?.body),
				});
				if (calls.length === 1) {
					return new Response("retry", { status: 503 });
				}
				return Response.json({ recipes: ["r1"] });
			},
		);
		const secretStore = {
			getSecretValue: vi.fn(async () => "callback-secret"),
		} as unknown as SecretStore;
		const tool = buildCallbackToolDefinition(
			{
				kind: "callback",
				name: "find_recipes",
				url: "https://nutritext.example/tools/find-recipes",
				inputSchema,
				secret: "nutritext_callback",
				maxRetries: 1,
			},
			{ secretStore, fetch: fetchMock },
		);

		expect(tool.modelInputSchema).toBe(inputSchema);
		expect(tool.input.safeParse({ tags: ["quick"], limit: 7 }).success).toBe(
			true,
		);
		expect(tool.input.safeParse({ tags: "quick" }).success).toBe(false);

		const result = await tool.execute(
			{ tags: ["quick"], limit: 7 },
			{
				agentId: "nutritionist",
				sessionId: "trusted-session",
				runId: "run_123",
				userId: "not-model-visible",
				invocationId: "inv_123",
				invoke: vi.fn() as never,
			},
		);

		expect(result).toEqual({ recipes: ["r1"] });
		expect(calls).toHaveLength(2);
		const first = calls[0]!;
		const second = calls[1]!;
		const deliveryId = first.headers.get(CALLBACK_DELIVERY_ID_HEADER)!;
		const timestamp = first.headers.get(CALLBACK_TIMESTAMP_HEADER)!;
		expect(second.headers.get(CALLBACK_DELIVERY_ID_HEADER)).toBe(deliveryId);
		expect(first.headers.get(CALLBACK_IDEMPOTENCY_HEADER)).toBe(deliveryId);
		expect(first.headers.get(CALLBACK_SIGNATURE_HEADER)).toBe(
			signCallback("callback-secret", timestamp, deliveryId, first.body),
		);
		expect(JSON.parse(first.body)).toMatchObject({
			tool: "find_recipes",
			args: { tags: ["quick"], limit: 7 },
			runtime: {
				sessionId: "trusted-session",
				runId: "run_123",
				agentId: "nutritionist",
			},
			delivery: { id: deliveryId, timestamp },
		});
		expect(first.body).not.toContain("not-model-visible");
		expect(second.body).toBe(first.body);
	});
});
