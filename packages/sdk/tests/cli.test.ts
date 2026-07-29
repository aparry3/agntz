import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "../dist/cli.js");
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("agntz validate", () => {
	it("emits a successful JSON report for a manifest directory", () => {
		const dir = createTempDir();
		writeFileSync(
			join(dir, "agent.yaml"),
			"id: hello\nkind: llm\nmodel: { provider: openai, name: gpt-5.4 }\ninstruction: Hello",
		);

		const result = runCli(["validate", dir, "--json"]);
		const report = JSON.parse(result.stdout) as {
			valid: boolean;
			counts: { files: number; errors: number };
		};
		expect(result.status).toBe(0);
		expect(report).toMatchObject({
			valid: true,
			counts: { files: 1, errors: 0 },
		});
	});

	it("returns a complete nonzero report for an unresolved reference", () => {
		const dir = createTempDir();
		writeFileSync(
			join(dir, "flow.yaml"),
			"id: flow\nkind: sequential\nsteps:\n  - ref: missing",
		);

		const result = runCli(["validate", dir, "--json"]);
		const report = JSON.parse(result.stdout) as {
			valid: boolean;
			files: Array<{ errors: Array<{ message: string }> }>;
		};
		expect(result.status).toBe(1);
		expect(report.valid).toBe(false);
		expect(report.files[0].errors[0].message).toContain("missing");
	});

	it("fails instead of reporting a false green for an empty directory", () => {
		const result = runCli(["validate", createTempDir(), "--json"]);
		const report = JSON.parse(result.stdout) as {
			valid: boolean;
			errors: Array<{ message: string }>;
			counts: { files: number; errors: number };
		};

		expect(result.status).toBe(1);
		expect(report.valid).toBe(false);
		expect(report.errors[0]?.message).toContain("No YAML agent manifests");
		expect(report.counts).toEqual({ files: 0, errors: 1, warnings: 0 });
	});

	it("defaults to ./agents and ignores dependency directories", () => {
		const dir = createTempDir();
		mkdirSync(join(dir, "agents", "node_modules"), { recursive: true });
		writeFileSync(
			join(dir, "agents", "hello.yaml"),
			"id: hello\nkind: llm\nmodel: { provider: openai, name: gpt-5.4 }\ninstruction: Hello",
		);
		writeFileSync(
			join(dir, "agents", "node_modules", "not-an-agent.yaml"),
			"lockfileVersion: 9",
		);

		const result = runCli(["validate", "--json"], dir);
		const report = JSON.parse(result.stdout) as {
			valid: boolean;
			counts: { files: number; errors: number; warnings: number };
		};
		expect(result.status).toBe(0);
		expect(report).toMatchObject({
			valid: true,
			counts: { files: 1, errors: 0, warnings: 0 },
		});
	});
});

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "agntz-cli-test-"));
	tempDirs.push(dir);
	return dir;
}

function runCli(args: string[], cwd?: string) {
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		cwd,
	});
}
