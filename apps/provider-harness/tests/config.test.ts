import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseArgs,
	requireConfiguredProvider,
	selectMatrix,
	selectTests,
} from "../src/config.js";
import type { ProviderModelEntry, TestDefinition } from "../src/types.js";

const matrix: readonly ProviderModelEntry[] = [
	{ provider: "openai", model: "current", capabilities: new Set(["text"]) },
	{ provider: "openai", model: "previous", capabilities: new Set(["text"]) },
	{ provider: "groq", model: "current", capabilities: new Set(["text"]) },
];

const tests: readonly TestDefinition[] = [
	definition("single-turn-text", "text"),
	definition("tool-roundtrip", "tools"),
	definition("structured-output", "structuredOutput"),
	definition("reasoning", "reasoning"),
];

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("parseArgs", () => {
	it("parses suites, SDKs, filters, and concurrency", () => {
		const args = parseArgs([
			"--suite=smoke",
			"--sdk",
			"both",
			"--provider",
			"openai,groq",
			"--global-concurrency=2",
			"--provider-start-interval-ms",
			"cohere=1000",
			"--require-credentials",
		]);

		expect(args).toMatchObject({
			suite: "smoke",
			sdk: "both",
			providerFilters: ["openai", "groq"],
			globalConcurrency: 2,
			providerStartIntervalMs: { cohere: 1000 },
			requireCredentials: true,
		});
	});

	it("rejects malformed numeric and provider values", () => {
		expect(() => parseArgs(["--global-concurrency=2x"])).toThrow(
			"Expected a positive integer",
		);
		expect(() => parseArgs(["--provider=unknown"])).toThrow(
			"Unknown provider filter",
		);
		expect(() => parseArgs(["--sdk"])).toThrow("Missing value for --sdk");
	});
});

describe("suite selection", () => {
	it("uses one representative model per provider for smoke runs", () => {
		const selected = selectMatrix(matrix, {
			suite: "smoke",
			providerFilters: [],
			modelFilters: [],
		});
		expect(selected.map((entry) => `${entry.provider}/${entry.model}`)).toEqual(
			["openai/current", "groq/current"],
		);
	});

	it("uses the three named representative tests for smoke runs", () => {
		const selected = selectTests(tests, {
			suite: "smoke",
			testFilters: [],
		});
		expect(selected.map((test) => test.id)).toEqual([
			"single-turn-text",
			"tool-roundtrip",
			"structured-output",
		]);
	});

	it("rejects misspelled test names instead of running an empty suite", () => {
		expect(() =>
			selectTests(tests, {
				suite: "smoke",
				testFilters: ["structuredOutput"],
			}),
		).toThrow("Unknown test filter");
	});
});

describe("credential preflight", () => {
	it("requires at least one configured provider when requested", () => {
		vi.stubEnv("OPENAI_API_KEY", "");
		expect(() => requireConfiguredProvider([matrix[0]])).toThrow(
			"No provider credentials configured",
		);

		vi.stubEnv("OPENAI_API_KEY", "configured");
		expect(() => requireConfiguredProvider([matrix[0]])).not.toThrow();
	});
});

function definition(
	id: string,
	capability: TestDefinition["capability"],
): TestDefinition {
	return {
		id,
		capability,
		async run() {
			return { ok: true };
		},
	};
}
