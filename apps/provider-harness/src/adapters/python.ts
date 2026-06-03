import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envVarFor } from "../credentials.js";
import type {
	HarnessGenerateTextOptions,
	HarnessGenerateTextResult,
	ProviderAdapter,
} from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
const PYTHON_DIR = resolve(REPO_ROOT, "python");
const BRIDGE = resolve(HERE, "../python-bridge.py");

export const pythonAdapter: ProviderAdapter = {
	sdk: "python",
	async generateText(
		options: HarnessGenerateTextOptions,
	): Promise<HarnessGenerateTextResult> {
		return runBridge(options);
	},
};

async function runBridge(
	options: HarnessGenerateTextOptions,
): Promise<HarnessGenerateTextResult> {
	const env = bridgeEnv(options);
	const child = spawn(pythonExecutable(), [BRIDGE], {
		cwd: PYTHON_DIR,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});

	const chunks: Buffer[] = [];
	const errors: Buffer[] = [];
	child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
	child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));

	const abort = () => child.kill("SIGTERM");
	options.signal?.addEventListener("abort", abort, { once: true });

	try {
		child.stdin.end(JSON.stringify(options));
		const code = await new Promise<number | null>((resolveExit, reject) => {
			child.on("error", reject);
			child.on("close", resolveExit);
		});
		const stdout = Buffer.concat(chunks).toString("utf8");
		const stderr = Buffer.concat(errors).toString("utf8");
		if (options.signal?.aborted) {
			throw new Error("Python provider call aborted");
		}
		if (code !== 0) {
			throw new Error(
				(
					stderr.trim() ||
					stdout.trim() ||
					`Python bridge exited ${code}`
				).slice(0, 2000),
			);
		}
		return JSON.parse(stdout) as HarnessGenerateTextResult;
	} finally {
		options.signal?.removeEventListener("abort", abort);
	}
}

function pythonExecutable(): string {
	if (process.env.PYTHON) return process.env.PYTHON;
	const venvPython = resolve(PYTHON_DIR, ".venv/bin/python");
	if (existsSync(venvPython)) return venvPython;
	return "python3";
}

function bridgeEnv(options: HarnessGenerateTextOptions): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env };
	env.PYTHONPATH = [resolve(PYTHON_DIR, "src"), env.PYTHONPATH]
		.filter(Boolean)
		.join(":");

	if (options.invalidApiKey) {
		env[envVarFor(options.model.provider)] =
			"invalid-agntz-harness-negative-test-key";
	}

	if (options.model.provider === "google") {
		const googleKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (googleKey && !env.GEMINI_API_KEY) {
			env.GEMINI_API_KEY = googleKey;
		}
		if (options.invalidApiKey) {
			env.GEMINI_API_KEY = "invalid-agntz-harness-negative-test-key";
		}
	}

	return env;
}
