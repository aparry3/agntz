import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReport } from "../src/report.js";
import type { ProviderModelEntry, TestResult } from "../src/types.js";

const matrix: readonly ProviderModelEntry[] = [
	{ provider: "openai", model: "test&model", capabilities: new Set(["text"]) },
];

const results: readonly TestResult[] = [
	{
		sdk: "ts",
		test: "single-turn-text",
		provider: "openai",
		model: "test&model",
		bucket: "PASS",
		durationMs: 10,
	},
	{
		sdk: "python",
		test: "tool-roundtrip",
		provider: "openai",
		model: "test&model",
		bucket: "SDK_ERROR",
		durationMs: 20,
		error: { name: "AssertionFailed", message: "missing <tool>" },
	},
];

describe("writeReport", () => {
	it("writes JSON, Markdown, and JUnit reports with stable latest links", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "agntz-provider-report-"));
		try {
			const written = await writeReport({
				startedAt: new Date("2026-07-10T12:00:00.000Z"),
				finishedAt: new Date("2026-07-10T12:00:01.000Z"),
				matrix,
				results,
				outputDir,
			});

			const json = JSON.parse(
				await readFile(resolve(written.jsonPath), "utf8"),
			) as { summary: Record<string, number> };
			const markdown = await readFile(resolve(written.markdownPath), "utf8");
			const junit = await readFile(resolve(written.junitPath), "utf8");

			expect(json.summary).toMatchObject({ PASS: 1, SDK_ERROR: 1 });
			expect(markdown).toContain("## Failures (require attention)");
			expect(junit).toContain('tests="2" failures="1"');
			expect(junit).toContain("test&amp;model");
			expect(junit).toContain("missing &lt;tool&gt;");
			expect(await readFile(resolve(written.latestJsonPath), "utf8")).toBe(
				await readFile(resolve(written.jsonPath), "utf8"),
			);
		} finally {
			await rm(outputDir, { recursive: true, force: true });
		}
	});
});
