import { envVarFor } from "./credentials.js";
import type {
	HarnessSdkSelection,
	Provider,
	ProviderModelEntry,
	TestDefinition,
} from "./types.js";

export type HarnessSuite = "smoke" | "compat";

export interface HarnessArgs {
	sdk: HarnessSdkSelection;
	suite: HarnessSuite;
	updateSnapshots: boolean;
	requireCredentials: boolean;
	globalConcurrency?: number;
	providerConcurrency?: number;
	providerStartIntervalMs: Partial<Record<Provider, number>>;
	providerFilters: readonly string[];
	modelFilters: readonly string[];
	testFilters: readonly string[];
}

export const SMOKE_TEST_IDS = [
	"single-turn-text",
	"tool-roundtrip",
	"structured-output",
] as const;

const PROVIDERS: readonly Provider[] = [
	"anthropic",
	"openai",
	"google",
	"mistral",
	"groq",
	"cohere",
	"openrouter",
];

export function parseArgs(argv: readonly string[]): HarnessArgs {
	const sdk = readValue(argv, "sdk") ?? "ts";
	if (sdk !== "ts" && sdk !== "python" && sdk !== "both") {
		throw new Error(
			`Invalid --sdk value "${sdk}". Expected ts, python, or both.`,
		);
	}

	const suite = readValue(argv, "suite") ?? "compat";
	if (suite !== "smoke" && suite !== "compat") {
		throw new Error(
			`Invalid --suite value "${suite}". Expected smoke or compat.`,
		);
	}

	const providerFilters = readList(argv, "provider");
	const invalidProviders = providerFilters.filter(
		(value) => !PROVIDERS.includes(value as Provider),
	);
	if (invalidProviders.length > 0) {
		throw new Error(
			`Unknown provider filter(s): ${invalidProviders.join(", ")}`,
		);
	}

	return {
		sdk,
		suite,
		updateSnapshots: argv.includes("--update-snapshots") || argv.includes("-u"),
		requireCredentials: argv.includes("--require-credentials"),
		globalConcurrency: readPositiveInteger(argv, "global-concurrency"),
		providerConcurrency: readPositiveInteger(argv, "provider-concurrency"),
		providerStartIntervalMs: readProviderIntervals(argv),
		providerFilters,
		modelFilters: readList(argv, "model"),
		testFilters: readList(argv, "test"),
	};
}

export function selectMatrix(
	entries: readonly ProviderModelEntry[],
	args: Pick<HarnessArgs, "suite" | "providerFilters" | "modelFilters">,
): ProviderModelEntry[] {
	const suiteEntries =
		args.suite === "smoke" ? firstEntryPerProvider(entries) : [...entries];
	const selected = suiteEntries.filter((entry) => {
		const providerMatches =
			args.providerFilters.length === 0 ||
			args.providerFilters.includes(entry.provider);
		const modelMatches =
			args.modelFilters.length === 0 ||
			args.modelFilters.some(
				(filter) =>
					entry.model.includes(filter) ||
					`${entry.provider}/${entry.model}`.includes(filter),
			);
		return providerMatches && modelMatches;
	});
	if (selected.length === 0) {
		throw new Error("Filters matched no models.");
	}
	return selected;
}

export function selectTests(
	tests: readonly TestDefinition[],
	args: Pick<HarnessArgs, "suite" | "testFilters">,
): TestDefinition[] {
	const availableIds = new Set(tests.map((test) => test.id));
	const unknownIds = args.testFilters.filter((id) => !availableIds.has(id));
	if (unknownIds.length > 0) {
		throw new Error(
			`Unknown test filter(s): ${unknownIds.join(", ")}. Available tests: ${[
				...availableIds,
			].join(", ")}`,
		);
	}

	const suiteIds = args.suite === "smoke" ? new Set(SMOKE_TEST_IDS) : undefined;
	const selected = tests.filter((test) => {
		if (suiteIds && !suiteIds.has(test.id as (typeof SMOKE_TEST_IDS)[number])) {
			return false;
		}
		return args.testFilters.length === 0 || args.testFilters.includes(test.id);
	});
	if (selected.length === 0) {
		throw new Error("Filters matched no tests.");
	}
	return selected;
}

export function requireConfiguredProvider(
	matrix: readonly ProviderModelEntry[],
): void {
	const providers = [...new Set(matrix.map((entry) => entry.provider))];
	if (
		providers.every((provider) => {
			const value = process.env[envVarFor(provider)];
			return typeof value !== "string" || value.trim().length === 0;
		})
	) {
		throw new Error(
			`No provider credentials configured. Set at least one of: ${providers
				.map(envVarFor)
				.join(", ")}`,
		);
	}
}

function firstEntryPerProvider(
	entries: readonly ProviderModelEntry[],
): ProviderModelEntry[] {
	const seen = new Set<Provider>();
	return entries.filter((entry) => {
		if (seen.has(entry.provider)) return false;
		seen.add(entry.provider);
		return true;
	});
}

function readPositiveInteger(
	argv: readonly string[],
	name: string,
): number | undefined {
	const raw = readValue(argv, name);
	if (raw === undefined) return undefined;
	if (!/^[1-9]\d*$/.test(raw)) {
		throw new Error(
			`Invalid --${name} value "${raw}". Expected a positive integer.`,
		);
	}
	return Number(raw);
}

function readProviderIntervals(
	argv: readonly string[],
): Partial<Record<Provider, number>> {
	const intervals: Partial<Record<Provider, number>> = {};
	for (const entry of readList(argv, "provider-start-interval-ms")) {
		const [provider, raw] = entry.split("=");
		if (!PROVIDERS.includes(provider as Provider)) {
			throw new Error(
				`Invalid --provider-start-interval-ms provider "${provider}".`,
			);
		}
		if (raw === undefined || !/^\d+$/.test(raw)) {
			throw new Error(
				`Invalid --provider-start-interval-ms value "${entry}". Expected provider=non-negative-integer.`,
			);
		}
		intervals[provider as Provider] = Number(raw);
	}
	return intervals;
}

function readList(argv: readonly string[], name: string): string[] {
	const flag = `--${name}`;
	const values: string[] = [];
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === flag) {
			const next = argv[index + 1];
			if (next === undefined || next.startsWith("--")) {
				throw new Error(`Missing value for ${flag}.`);
			}
			values.push(next);
			index++;
		} else if (argument.startsWith(`${flag}=`)) {
			values.push(argument.slice(flag.length + 1));
		}
	}
	return values
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter(Boolean);
}

function readValue(argv: readonly string[], name: string): string | undefined {
	const values = readList(argv, name);
	if (values.length > 1) {
		throw new Error(`Expected a single --${name} value.`);
	}
	return values[0];
}
