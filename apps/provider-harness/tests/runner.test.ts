import { afterEach, describe, expect, it, vi } from "vitest";
import { runMatrix } from "../src/runner.js";
import type {
	ProviderAdapter,
	ProviderModelEntry,
	TestDefinition,
} from "../src/types.js";

const model: ProviderModelEntry = {
	provider: "openai",
	model: "test-model",
	capabilities: new Set(["text"]),
};

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("runMatrix", () => {
	it("skips providers without credentials before calling an adapter", async () => {
		vi.stubEnv("OPENAI_API_KEY", "");
		const adapter = adapterReturning("unused");
		const results = await runMatrix({
			matrix: [model],
			tests: [passingTest()],
			adapters: [adapter],
		});

		expect(results[0]).toMatchObject({
			bucket: "SKIPPED",
			skipReason: "no OPENAI_API_KEY in environment",
		});
		expect(adapter.generateText).not.toHaveBeenCalled();
	});

	it("treats a configured but rejected credential as a regression", async () => {
		vi.stubEnv("OPENAI_API_KEY", "invalid");
		const adapter: ProviderAdapter = {
			sdk: "ts",
			generateText: vi.fn(async () => {
				throw new Error("invalid api key");
			}),
		};
		const results = await runMatrix({
			matrix: [model],
			tests: [passingTest()],
			adapters: [adapter],
		});

		expect(results[0]).toMatchObject({
			bucket: "SDK_ERROR",
			error: { name: "CredentialError" },
		});
	});

	it("records passing calls", async () => {
		vi.stubEnv("OPENAI_API_KEY", "configured");
		const results = await runMatrix({
			matrix: [model],
			tests: [passingTest()],
			adapters: [adapterReturning("OK")],
		});

		expect(results[0].bucket).toBe("PASS");
	});

	it("records abort-aware timeouts as regressions", async () => {
		vi.stubEnv("OPENAI_API_KEY", "configured");
		const test: TestDefinition = {
			id: "timeout",
			capability: "text",
			timeoutMs: 5,
			async run(_entry, context) {
				await new Promise<void>((_resolve, reject) => {
					context.abortSignal?.addEventListener(
						"abort",
						() => reject(new Error("aborted")),
						{ once: true },
					);
				});
				return { ok: true };
			},
		};
		const results = await runMatrix({
			matrix: [model],
			tests: [test],
			adapters: [adapterReturning("unused")],
		});

		expect(results[0].bucket).toBe("TIMEOUT");
	});
});

function passingTest(): TestDefinition {
	return {
		id: "single-turn-text",
		capability: "text",
		async run(entry, context) {
			const result = await context.adapter.generateText({
				model: { provider: entry.provider, name: entry.model },
				messages: [],
			});
			return { ok: result.text.length > 0 };
		},
	};
}

function adapterReturning(text: string): ProviderAdapter {
	return {
		sdk: "ts",
		generateText: vi.fn(async () => ({ text })),
	};
}
