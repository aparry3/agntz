import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const skipReasons = [];

if (process.env.CI === "true") {
	skipReasons.push("CI=true");
}

if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) {
	skipReasons.push("Railway deploy");
}

if (!existsSync(".git")) {
	skipReasons.push("no .git directory");
}

if (skipReasons.length > 0) {
	console.log(`Skipping lefthook install (${skipReasons.join(", ")}).`);
	process.exit(0);
}

const git = spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });

if (git.error || git.status !== 0) {
	console.log("Skipping lefthook install (git is not available).");
	process.exit(0);
}

const lefthookCommand =
	process.platform === "win32" ? "lefthook.cmd" : "lefthook";
const lefthook = spawnSync(lefthookCommand, ["install"], { stdio: "inherit" });

if (lefthook.error) {
	console.error(`Failed to run lefthook install: ${lefthook.error.message}`);
	process.exit(1);
}

process.exit(lefthook.status ?? 1);
