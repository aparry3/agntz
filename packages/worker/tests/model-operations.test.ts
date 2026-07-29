import { describe, expect, it, vi } from "vitest";
import { HostedOperationRegistry } from "../src/model-operations.js";

describe("HostedOperationRegistry", () => {
	it("supports host-provided future operation adapters", async () => {
		const registry = new HostedOperationRegistry();
		const adapter = vi.fn(async () => ({
			output: { embeddings: [[0.1, 0.2]] },
			metadata: {
				provider: "custom",
				requestedModel: "embed-v1",
				model: "embed-v1",
				usage: {
					promptTokens: 2,
					completionTokens: 0,
					totalTokens: 2,
				},
			},
		}));

		registry.register("embedding", adapter);
		expect(registry.list()).toEqual(["embedding"]);
		const result = await registry.execute("embedding", {} as never);
		expect(result.output).toEqual({ embeddings: [[0.1, 0.2]] });
		expect(adapter).toHaveBeenCalledOnce();
		expect(() => registry.register("embedding", adapter)).toThrow(
			"already registered",
		);
		await expect(registry.execute("speech", {} as never)).rejects.toThrow(
			"No hosted operation adapter",
		);
	});
});
