import { pythonAdapter } from "./adapters/python.js";
import { tsAdapter } from "./adapters/ts.js";
import { maybeOpenIssue } from "./github.js";
import { ALL_CAPABILITIES, MATRIX } from "./matrix.js";
import { writeReport } from "./report.js";
import { runMatrix } from "./runner.js";
import { ALL_TESTS } from "./tests/index.js";
import type {
	Capability,
	HarnessSdkSelection,
	ProviderAdapter,
	ProviderModelEntry,
	ResultBucket,
	TestResult,
} from "./types.js";

const SHORT_LABEL: Record<Capability, string> = {
	text: "text",
	multiTurn: "mult",
	systemPrompt: "sys",
	streaming: "strm",
	tools: "tool",
	parallelTools: "ptl",
	streamingTools: "stl",
	toolChoice: "tch",
	multimodalImage: "img",
	structuredOutput: "json",
	reasoning: "rsn",
	cancellation: "cncl",
};

const COL = 5;

function pad(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function printMatrix(entries: readonly ProviderModelEntry[]): void {
	const providerW =
		Math.max("provider".length, ...entries.map((e) => e.provider.length)) + 2;
	const modelW =
		Math.max("model".length, ...entries.map((e) => e.model.length)) + 2;

	const header =
		pad("provider", providerW) +
		pad("model", modelW) +
		ALL_CAPABILITIES.map((c) => pad(SHORT_LABEL[c], COL)).join("");

	const rule = `${"─".repeat(providerW - 2)}  ${"─".repeat(modelW - 2)}  ${ALL_CAPABILITIES.map(() => `${"─".repeat(COL - 1)} `).join("")}`;

	console.log(`  ${header}`);
	console.log(`  ${rule}`);

	for (const entry of entries) {
		const row =
			pad(entry.provider, providerW) +
			pad(entry.model, modelW) +
			ALL_CAPABILITIES.map((c) =>
				pad(entry.capabilities.has(c) ? "✓" : "·", COL),
			).join("");
		console.log(`  ${row}`);
	}
}

const BUCKET_COLOR: Record<ResultBucket, string> = {
	PASS: "\x1b[32m",
	EXPECTED_UNSUPPORTED: "\x1b[32m",
	UNEXPECTED_UNSUPPORTED: "\x1b[33m",
	SDK_ERROR: "\x1b[31m",
	PROVIDER_ERROR: "\x1b[34m",
	RATE_LIMITED: "\x1b[36m",
	TIMEOUT: "\x1b[35m",
	SKIPPED: "\x1b[90m",
};
const RESET = "\x1b[0m";

function bucketCell(b: ResultBucket): string {
	return `${BUCKET_COLOR[b]}${pad(b, 24)}${RESET}`;
}

function printResults(results: readonly TestResult[]): void {
	const sdkW = Math.max("sdk".length, ...results.map((r) => r.sdk.length)) + 2;
	const slugW =
		Math.max(...results.map((r) => `${r.provider}/${r.model}`.length)) + 2;
	const testW = Math.max(...results.map((r) => r.test.length)) + 2;

	// Stable ordering: by matrix order × test order (Promise.all preserves this).
	for (const r of results) {
		const slug = `${r.provider}/${r.model}`;
		const detail =
			r.bucket === "SKIPPED"
				? `  ${r.skipReason ?? ""}`
				: r.bucket === "PASS" || r.bucket === "EXPECTED_UNSUPPORTED"
					? `  ${r.durationMs}ms`
					: `  ${r.durationMs}ms  ${r.error?.message ?? ""}`;
		console.log(
			`  ${pad(r.sdk, sdkW)}${pad(slug, slugW)}${pad(r.test, testW)}${bucketCell(r.bucket)}${detail}`,
		);
	}
}

function printSummary(results: readonly TestResult[]): void {
	const counts: Record<ResultBucket, number> = {
		PASS: 0,
		EXPECTED_UNSUPPORTED: 0,
		UNEXPECTED_UNSUPPORTED: 0,
		SDK_ERROR: 0,
		PROVIDER_ERROR: 0,
		RATE_LIMITED: 0,
		TIMEOUT: 0,
		SKIPPED: 0,
	};
	for (const r of results) counts[r.bucket]++;

	const parts: string[] = [`${results.length} results`];
	for (const [bucket, n] of Object.entries(counts) as [
		ResultBucket,
		number,
	][]) {
		if (n > 0) parts.push(`${n} ${bucket}`);
	}
	console.log(`  ${parts.join(" · ")}`);
}

// Safety net: a floating rejection from a provider stream must never crash the
// whole run. consumeStream already settles trailing stream promises, so this
// should stay at zero — if it doesn't, that's a path we haven't hardened.
let unhandledRejections = 0;
process.on("unhandledRejection", () => {
	unhandledRejections++;
});

function parseArgs(argv: readonly string[]): {
	sdk: HarnessSdkSelection;
	updateSnapshots: boolean;
	reportGithub: boolean;
	githubDryRun: boolean;
	globalConcurrency?: number;
	providerConcurrency?: number;
	providerFilters: readonly string[];
	modelFilters: readonly string[];
	testFilters: readonly string[];
} {
	const sdk = parseSdk(argv);
	if (sdk !== "ts" && sdk !== "python" && sdk !== "both") {
		throw new Error(
			`Invalid --sdk value "${sdk}". Expected ts, python, or both.`,
		);
	}
	return {
		sdk,
		updateSnapshots: argv.includes("--update-snapshots") || argv.includes("-u"),
		reportGithub: argv.includes("--report-github"),
		githubDryRun: argv.includes("--github-dry-run"),
		globalConcurrency: parsePositiveIntFlag(argv, "global-concurrency"),
		providerConcurrency: parsePositiveIntFlag(argv, "provider-concurrency"),
		providerFilters: parseListFlag(argv, "provider"),
		modelFilters: parseListFlag(argv, "model"),
		testFilters: parseListFlag(argv, "test"),
	};
}

function parseSdk(argv: readonly string[]): HarnessSdkSelection {
	const equalsArg = argv.find((arg) => arg.startsWith("--sdk="));
	if (equalsArg) return equalsArg.slice("--sdk=".length) as HarnessSdkSelection;
	const flagIndex = argv.indexOf("--sdk");
	if (flagIndex !== -1) {
		return (argv[flagIndex + 1] || "ts") as HarnessSdkSelection;
	}
	return "ts";
}

function parsePositiveIntFlag(
	argv: readonly string[],
	name: string,
): number | undefined {
	const flag = `--${name}`;
	const equalsArg = argv.find((arg) => arg.startsWith(`${flag}=`));
	const raw =
		equalsArg?.slice(`${flag}=`.length) ??
		(argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
	if (raw === undefined) return undefined;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		throw new Error(
			`Invalid ${flag} value "${raw}". Expected a positive integer.`,
		);
	}
	return parsed;
}

function parseListFlag(argv: readonly string[], name: string): string[] {
	const flag = `--${name}`;
	const values: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === flag) {
			const next = argv[i + 1];
			if (next !== undefined) {
				values.push(next);
				i++;
			}
			continue;
		}
		if (arg.startsWith(`${flag}=`)) {
			values.push(arg.slice(`${flag}=`.length));
		}
	}
	return values
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter(Boolean);
}

function adaptersFor(selection: HarnessSdkSelection): ProviderAdapter[] {
	if (selection === "ts") return [tsAdapter];
	if (selection === "python") return [pythonAdapter];
	return [tsAdapter, pythonAdapter];
}

function filterMatrix(
	entries: readonly ProviderModelEntry[],
	args: {
		providerFilters: readonly string[];
		modelFilters: readonly string[];
	},
): ProviderModelEntry[] {
	return entries.filter((entry) => {
		const providerOk =
			args.providerFilters.length === 0 ||
			args.providerFilters.includes(entry.provider);
		const modelOk =
			args.modelFilters.length === 0 ||
			args.modelFilters.some(
				(filter) =>
					entry.model.includes(filter) ||
					`${entry.provider}/${entry.model}`.includes(filter),
			);
		return providerOk && modelOk;
	});
}

function filterTests(
	tests: typeof ALL_TESTS,
	args: { testFilters: readonly string[] },
): typeof ALL_TESTS {
	return tests.filter(
		(test) =>
			args.testFilters.length === 0 || args.testFilters.includes(test.id),
	) as typeof ALL_TESTS;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const adapters = adaptersFor(args.sdk);
	const matrix = filterMatrix(MATRIX, args);
	const tests = filterTests(ALL_TESTS, args);
	if (matrix.length === 0) {
		throw new Error("Filters matched no models.");
	}
	if (tests.length === 0) {
		throw new Error("Filters matched no tests.");
	}
	console.log("");
	console.log(
		"  agntz · provider harness · v0.1 — Phase 4 (snapshot infrastructure)",
	);
	console.log(`  SDK target: ${args.sdk}`);
	if (args.updateSnapshots) {
		console.log(
			"  Snapshot update mode: existing snapshots will be overwritten.",
		);
	}
	if (args.providerConcurrency !== undefined) {
		console.log(`  Provider concurrency: ${args.providerConcurrency}`);
	}
	if (args.globalConcurrency !== undefined) {
		console.log(`  Global concurrency: ${args.globalConcurrency}`);
	}
	if (args.providerFilters.length > 0) {
		console.log(`  Provider filter: ${args.providerFilters.join(", ")}`);
	}
	if (args.modelFilters.length > 0) {
		console.log(`  Model filter: ${args.modelFilters.join(", ")}`);
	}
	if (args.testFilters.length > 0) {
		console.log(`  Test filter: ${args.testFilters.join(", ")}`);
	}
	console.log("");
	console.log(
		`  Matrix: ${matrix.length} models, ${ALL_CAPABILITIES.length} capability dimensions`,
	);
	console.log(`  Tests: ${tests.length}`);
	console.log("");
	printMatrix(matrix);
	console.log("");
	console.log(
		`  Running ${tests.length} test(s) × ${matrix.length} models × ${adapters.length} SDK target(s) in parallel...`,
	);
	console.log("");

	// Silence core's per-call diagnostic logging during the run — it dumps full
	// stack traces for every failure (including the SKIPPED cases) and drowns
	// the harness's structured output. The TestResult.error field captures the
	// essentials we actually need.
	const originalStderrWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = (() => true) as typeof process.stderr.write;
	const startedAt = new Date();
	let results: TestResult[];
	try {
		results = await runMatrix({
			matrix,
			tests,
			adapters,
			updateSnapshots: args.updateSnapshots,
			globalConcurrency: args.globalConcurrency,
			providerConcurrency: args.providerConcurrency,
		});
	} finally {
		process.stderr.write = originalStderrWrite;
	}
	const finishedAt = new Date();

	printResults(results);
	console.log("");
	console.log("  Summary");
	console.log("  ───────");
	printSummary(results);
	if (unhandledRejections > 0) {
		console.log(
			`  ⚠ ${unhandledRejections} unhandled rejection(s) absorbed — a stream path needs hardening.`,
		);
	}
	console.log("");

	const written = await writeReport({
		startedAt,
		finishedAt,
		matrix,
		results,
	});
	console.log(`  Wrote ${written.markdownPath}`);
	console.log(`  Wrote ${written.jsonPath}`);
	console.log(`  Symlinked ${written.latestMarkdownPath} → latest`);

	await maybeOpenIssue({
		enabled: args.reportGithub || args.githubDryRun,
		dryRun: args.githubDryRun,
		results,
		markdownPath: written.markdownPath,
	});
	console.log("");

	const hasFailure = results.some(
		(r) => r.bucket === "SDK_ERROR" || r.bucket === "UNEXPECTED_UNSUPPORTED",
	);
	process.exit(hasFailure ? 1 : 0);
}

main().catch((err) => {
	console.error("");
	console.error("  Harness crashed before completing:");
	console.error(err);
	process.exit(2);
});
