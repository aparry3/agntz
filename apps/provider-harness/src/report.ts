import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_CAPABILITIES } from "./matrix.js";
import type { ProviderModelEntry, ResultBucket, TestResult } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(HERE, "..", "reports");

export interface ReportInput {
	startedAt: Date;
	finishedAt: Date;
	matrix: readonly ProviderModelEntry[];
	results: readonly TestResult[];
}

export interface WrittenReport {
	jsonPath: string;
	markdownPath: string;
	latestJsonPath: string;
	latestMarkdownPath: string;
}

export async function writeReport(input: ReportInput): Promise<WrittenReport> {
	await mkdir(REPORTS_DIR, { recursive: true });

	const slug = isoSlug(input.finishedAt);
	const jsonPath = resolve(REPORTS_DIR, `${slug}.json`);
	const markdownPath = resolve(REPORTS_DIR, `${slug}.md`);
	const latestJsonPath = resolve(REPORTS_DIR, "latest.json");
	const latestMarkdownPath = resolve(REPORTS_DIR, "latest.md");

	await writeFile(jsonPath, buildJson(input), "utf8");
	await writeFile(markdownPath, buildMarkdown(input), "utf8");

	await refreshSymlink(latestJsonPath, `${slug}.json`);
	await refreshSymlink(latestMarkdownPath, `${slug}.md`);

	return {
		jsonPath: relative(process.cwd(), jsonPath),
		markdownPath: relative(process.cwd(), markdownPath),
		latestJsonPath: relative(process.cwd(), latestJsonPath),
		latestMarkdownPath: relative(process.cwd(), latestMarkdownPath),
	};
}

function isoSlug(d: Date): string {
	// 2026-05-23T18-04-12Z — filesystem-safe ISO
	return d
		.toISOString()
		.replace(/[:.]/g, "-")
		.replace(/-\d{3}Z$/, "Z");
}

function buildJson(input: ReportInput): string {
	const payload = {
		schemaVersion: 1,
		startedAt: input.startedAt.toISOString(),
		finishedAt: input.finishedAt.toISOString(),
		durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
		summary: countByBucket(input.results),
		matrix: input.matrix.map((m) => ({
			provider: m.provider,
			model: m.model,
			capabilities: [...m.capabilities].sort(),
			notes: m.notes,
		})),
		results: input.results,
	};
	return `${JSON.stringify(payload, null, 2)}\n`;
}

function buildMarkdown(input: ReportInput): string {
	const lines: string[] = [];
	const counts = countByBucket(input.results);
	const totalMs = input.finishedAt.getTime() - input.startedAt.getTime();

	lines.push("# agntz provider-harness — report");
	lines.push("");
	lines.push(`- **Started:** ${input.startedAt.toISOString()}`);
	lines.push(`- **Finished:** ${input.finishedAt.toISOString()}`);
	lines.push(`- **Wall time:** ${totalMs}ms`);
	lines.push(
		`- **Matrix:** ${input.matrix.length} models · ${ALL_CAPABILITIES.length} capability dimensions`,
	);
	lines.push("");
	lines.push("## Summary");
	lines.push("");
	lines.push(`Total: **${input.results.length}** results`);
	lines.push("");
	lines.push("| Bucket | Count |");
	lines.push("| --- | ---: |");
	for (const [bucket, n] of Object.entries(counts) as [
		ResultBucket,
		number,
	][]) {
		if (n > 0) lines.push(`| ${bucket} | ${n} |`);
	}
	lines.push("");
	lines.push("## Capability matrix");
	lines.push("");
	lines.push(buildMatrixTable(input.matrix));
	lines.push("");
	lines.push("## Results");
	lines.push("");
	lines.push(buildResultsTable(input.results));

	const failing = input.results.filter(
		(r) => r.bucket === "SDK_ERROR" || r.bucket === "UNEXPECTED_UNSUPPORTED",
	);
	if (failing.length > 0) {
		lines.push("");
		lines.push("## Failures (require attention)");
		lines.push("");
		for (const r of failing) {
			lines.push(`### ${r.provider}/${r.model} · ${r.test} · ${r.bucket}`);
			lines.push("");
			if (r.error) {
				lines.push("```");
				lines.push(`${r.error.name}: ${r.error.message}`);
				if (r.error.stack) lines.push(r.error.stack);
				lines.push("```");
			}
			if (r.snapshotDiff) {
				lines.push("");
				lines.push("Snapshot diff:");
				lines.push("");
				lines.push("```diff");
				lines.push(r.snapshotDiff);
				lines.push("```");
			}
			lines.push("");
		}
	}

	return lines.join("\n");
}

function buildMatrixTable(matrix: readonly ProviderModelEntry[]): string {
	const headers = ["provider", "model", ...ALL_CAPABILITIES];
	const sep = headers.map(() => "---");
	const rows = matrix.map((m) => [
		m.provider,
		m.model,
		...ALL_CAPABILITIES.map((c) => (m.capabilities.has(c) ? "✓" : "·")),
	]);
	return [headers, sep, ...rows]
		.map((row) => `| ${row.join(" | ")} |`)
		.join("\n");
}

function buildResultsTable(results: readonly TestResult[]): string {
	const headers = ["provider", "model", "test", "bucket", "duration", "detail"];
	const sep = headers.map(() => "---");
	const rows = results.map((r) => [
		r.provider,
		r.model,
		r.test,
		r.bucket,
		`${r.durationMs}ms`,
		detailOf(r),
	]);
	return [headers, sep, ...rows]
		.map((row) => `| ${row.join(" | ")} |`)
		.join("\n");
}

function detailOf(r: TestResult): string {
	if (r.bucket === "SKIPPED") return r.skipReason ?? "";
	if (r.bucket === "PASS" || r.bucket === "EXPECTED_UNSUPPORTED") return "";
	return (r.error?.message ?? "").replace(/\n/g, " ").slice(0, 200);
}

function countByBucket(
	results: readonly TestResult[],
): Record<ResultBucket, number> {
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
	return counts;
}

async function refreshSymlink(linkPath: string, target: string): Promise<void> {
	try {
		await unlink(linkPath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
	await symlink(target, linkPath);
}
