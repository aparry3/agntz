import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ResultBucket, TestResult } from "./types.js";

const execFileAsync = promisify(execFile);

const FAILURE_BUCKETS: ReadonlySet<ResultBucket> = new Set<ResultBucket>([
	"SDK_ERROR",
	"UNEXPECTED_UNSUPPORTED",
]);

const LABEL = "provider-regression";

export interface GithubReportOptions {
	enabled: boolean;
	dryRun: boolean;
	results: readonly TestResult[];
	markdownPath: string;
}

export async function maybeOpenIssue(opts: GithubReportOptions): Promise<void> {
	if (!opts.enabled) return;

	const failures = opts.results.filter((r) => FAILURE_BUCKETS.has(r.bucket));
	if (failures.length === 0) {
		console.log("  --report-github: no regressions; not opening an issue.");
		return;
	}

	const title = `provider-harness: ${failures.length} regression(s) — ${new Date()
		.toISOString()
		.slice(0, 10)}`;
	const body = buildIssueBody(failures, opts.markdownPath);
	const args = [
		"issue",
		"create",
		"--title",
		title,
		"--body",
		body,
		"--label",
		LABEL,
	];

	if (opts.dryRun) {
		console.log("  --report-github (dry run): would run:");
		console.log(
			`    gh issue create --title ${JSON.stringify(title)} --label ${LABEL} --body <${body.length} chars>`,
		);
		return;
	}

	if (!(await ghAvailable())) {
		console.log(
			"  --report-github: `gh` CLI not found on PATH; skipping issue creation.",
		);
		return;
	}

	// Ensure the label exists (idempotent); ignore failures (already exists / no perms).
	try {
		await execFileAsync("gh", [
			"label",
			"create",
			LABEL,
			"--color",
			"B04823",
			"--description",
			"provider-harness regression",
			"--force",
		]);
	} catch {
		// best-effort
	}

	try {
		const { stdout } = await execFileAsync("gh", args);
		console.log(`  --report-github: opened issue → ${stdout.trim()}`);
	} catch (err) {
		console.log(
			`  --report-github: failed to open issue: ${(err as Error).message}`,
		);
	}
}

async function ghAvailable(): Promise<boolean> {
	try {
		await execFileAsync("gh", ["--version"]);
		return true;
	} catch {
		return false;
	}
}

function buildIssueBody(
	failures: readonly TestResult[],
	markdownPath: string,
): string {
	const lines: string[] = [];
	lines.push(`provider-harness detected **${failures.length}** regression(s).`);
	lines.push("");
	lines.push(`- Generated: ${new Date().toISOString()}`);
	lines.push(`- Local report: \`${markdownPath}\``);
	lines.push("");
	for (const f of failures) {
		lines.push(`### ${f.provider}/${f.model} · ${f.test} · ${f.bucket}`);
		if (f.error) {
			lines.push("```");
			lines.push(`${f.error.name}: ${f.error.message}`);
			lines.push("```");
		}
		if (f.snapshotDiff) {
			lines.push("```diff");
			lines.push(f.snapshotDiff);
			lines.push("```");
		}
		lines.push("");
	}
	lines.push("— opened by `provider-harness --report-github`");
	return lines.join("\n");
}
