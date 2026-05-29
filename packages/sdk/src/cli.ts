#!/usr/bin/env node

/**
 * agntz CLI
 *
 * Local (no auth):
 *   create   — generate a YAML manifest from a description (calls deployed worker)
 *   run      — execute a local YAML/dir against the in-process runtime
 *
 * Hosted (requires login):
 *   run <id>       — execute a saved agent via the hosted API
 *   runs list/get/cancel/stream
 *   traces list/get/delete
 *
 * Auth (current phase):
 *   AGNTZ_API_KEY env var, OR
 *   `agntz login --key <key>` writes ~/.agntz/config.json
 */

import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { AgntzClient } from "@agntz/client";
import type { MultiplexedRunEvent, StreamEvent } from "@agntz/client";
import { agntz } from "./client.js";
import { loadManifestFromFile, parseManifestString } from "./loader.js";

const DEFAULT_API_URL = "https://api.agntz.co";
const CONFIG_DIR = join(homedir(), ".agntz");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

interface CliConfig {
	apiKey?: string;
	apiUrl?: string;
}

const HELP = `agntz — run, build, and manage agntz agents from the terminal

Usage:
  agntz <command> [args] [options]

Local (no auth required):
  create "<description>" [-o <path>] [--stdout]
      Generate a YAML manifest from a description via the hosted agent-builder.
      Default output: ./agents/<id>.yaml

  run <path-or-id> [--input <text>] [--session <id>] [--stream]
      Execute an agent. If <path-or-id> ends in .yaml/.yml or is a directory,
      runs locally. Bare ids require login and run against the hosted API.
      Reads stdin if --input is omitted and stdin is piped.

Hosted (requires login):
  runs list [--agent <id>] [--status <s>] [--limit <n>]
  runs get <runId>
  runs stream <runId> [--since <seq>]
  runs cancel <runId>

  traces list [--agent <id>] [--status <s>] [--limit <n>]
  traces get <traceId>
  traces delete <traceId>

Auth:
  login --key <apiKey> [--url <apiUrl>]
      Save credentials to ~/.agntz/config.json (0600 perms).
  logout
      Remove ~/.agntz/config.json.
  whoami
      Show the configured API URL and whether a key is set.

Environment:
  AGNTZ_API_KEY     Overrides the saved key.
  AGNTZ_API_URL     Overrides the saved URL (default ${DEFAULT_API_URL}).

Options:
  -h, --help        Show help
  -v, --version     Show version
`;

async function main(): Promise<void> {
	const argv = process.argv.slice(2);

	if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
		process.stdout.write(HELP);
		return;
	}
	if (argv[0] === "-v" || argv[0] === "--version") {
		process.stdout.write(`${await loadCliVersion()}\n`);
		return;
	}

	const [command, ...rest] = argv;
	switch (command) {
		case "create":
			await cmdCreate(rest);
			return;
		case "run":
			await cmdRun(rest);
			return;
		case "login":
			await cmdLogin(rest);
			return;
		case "logout":
			await cmdLogout();
			return;
		case "whoami":
			await cmdWhoami();
			return;
		case "runs":
			await cmdRuns(rest);
			return;
		case "traces":
			await cmdTraces(rest);
			return;
		default:
			fail(`Unknown command: ${command}\n\nRun 'agntz --help' for usage.`);
	}
}

async function loadCliVersion(): Promise<string> {
	try {
		// Resolves to the bundled package.json at runtime — tsup keeps the package
		// root above dist/, so cli.js lives at dist/cli.js and ../package.json
		// works from there.
		const pkgUrl = new URL("../package.json", import.meta.url);
		const text = await readFile(pkgUrl, "utf8");
		const pkg = JSON.parse(text) as { version?: string };
		return `agntz v${pkg.version ?? "unknown"}`;
	} catch {
		return "agntz vunknown";
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// create — call the public /build-agent endpoint
// ─────────────────────────────────────────────────────────────────────────────

async function cmdCreate(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			output: { type: "string", short: "o" },
			stdout: { type: "boolean", default: false },
			"current-manifest": { type: "string" },
			url: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});

	const description = positionals.join(" ").trim();
	if (!description) {
		fail('Usage: agntz create "<description>" [-o <path>] [--stdout]');
	}

	const apiUrl = resolveApiUrl(values.url);
	const stopSpinner = startSpinner([
		{ ms: 0, label: "Planning structure" },
		{ ms: 6000, label: "Generating YAML" },
		{ ms: 14000, label: "Validating" },
		{ ms: 22000, label: "Finalizing" },
	]);

	let response: BuildAgentResponse;
	try {
		response = await callBuildAgent({
			apiUrl,
			description,
			currentManifest: values["current-manifest"],
		});
	} catch (err) {
		stopSpinner("fail");
		fail(formatError(err));
	} finally {
		stopSpinner();
	}

	if (!response.yaml) {
		fail(
			`Agent builder did not return a YAML manifest.${response.validation?.errors ? `\nValidation errors:\n${formatJson(response.validation.errors)}` : ""}`,
		);
	}

	if (values.stdout) {
		process.stdout.write(response.yaml);
		if (!response.yaml.endsWith("\n")) process.stdout.write("\n");
		return;
	}

	const manifest = parseManifestString(response.yaml);
	const defaultPath = join(process.cwd(), "agents", `${manifest.id}.yaml`);
	const outPath = values.output ? resolve(values.output) : defaultPath;
	await mkdir(dirname(outPath), { recursive: true });
	await writeFile(outPath, response.yaml);

	log(`✓ Wrote ${relPath(outPath)}`);
	log(`  id: ${manifest.id}`);
	if (manifest.name) log(`  name: ${manifest.name}`);
	if (response.explanation) {
		log(`\n${response.explanation.trim()}`);
	}
	log(`\nRun it locally:\n  agntz run ${relPath(outPath)} --input "..."`);
}

interface BuildAgentResponse {
	yaml: string | null;
	explanation: string | null;
	validation: { valid?: boolean; errors?: unknown } | null;
}

async function callBuildAgent(opts: {
	apiUrl: string;
	description: string;
	currentManifest?: string;
}): Promise<BuildAgentResponse> {
	const url = joinUrl(opts.apiUrl, "/build-agent");
	const body: Record<string, unknown> = { description: opts.description };
	if (opts.currentManifest) body.currentManifest = opts.currentManifest;

	let res: Response;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch (e) {
		throw new Error(`Network error reaching ${url}: ${(e as Error).message}`);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		if (res.status === 429) {
			const retry = res.headers.get("retry-after");
			throw new Error(
				`Rate limit exceeded${retry ? ` — retry in ${retry}s` : ""}. ${text}`,
			);
		}
		throw new Error(`Worker returned ${res.status} ${res.statusText}: ${text}`);
	}
	return (await res.json()) as BuildAgentResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
// run — local YAML/dir OR hosted by id
// ─────────────────────────────────────────────────────────────────────────────

async function cmdRun(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			input: { type: "string" },
			session: { type: "string" },
			stream: { type: "boolean", default: false },
			local: { type: "boolean", default: false },
			remote: { type: "boolean", default: false },
		},
		allowPositionals: true,
		strict: true,
	});

	if (positionals.length === 0) {
		fail(
			"Usage: agntz run <path-or-id> [--input <text>] [--session <id>] [--stream]",
		);
	}
	const target = positionals[0];
	const trailingInput = positionals.slice(1).join(" ").trim();

	const inputText = await resolveInput(values.input, trailingInput);
	const sessionId = values.session;

	const isLocalShape =
		values.local ||
		target.includes("/") ||
		target.startsWith(".") ||
		/\.(ya?ml)$/i.test(target);

	if (values.remote || (!isLocalShape && !values.local)) {
		await runHosted({
			agentId: target,
			input: inputText,
			sessionId,
			stream: values.stream,
		});
		return;
	}
	await runLocal({
		target,
		input: inputText,
		sessionId,
		stream: values.stream,
	});
}

async function runLocal(opts: {
	target: string;
	input: string;
	sessionId?: string;
	stream: boolean;
}): Promise<void> {
	const path = resolve(opts.target);
	if (!existsSync(path)) fail(`Path not found: ${opts.target}`);

	let agentsDir: string;
	let agentId: string | undefined;
	if (/\.(ya?ml)$/i.test(path)) {
		const manifest = await loadManifestFromFile(path);
		agentsDir = dirname(path);
		agentId = manifest.id;
	} else {
		agentsDir = path;
	}

	const client = await agntz({ agents: agentsDir });

	if (!agentId) {
		// Directory case: if the dir has exactly one manifest, use it; otherwise
		// require the caller to point at a specific file. Saves a foot-gun where
		// a casual `agntz run ./agents/` silently picks an arbitrary agent.
		const ids = [...client.manifests.keys()];
		if (ids.length === 1) {
			agentId = ids[0];
		} else {
			fail(
				`Directory ${opts.target} contains ${ids.length} agents. Specify a file path or use 'agntz run <id>' against the hosted API.`,
			);
		}
	}

	if (opts.stream) {
		for await (const event of client.agents.stream({
			agentId,
			input: opts.input,
			sessionId: opts.sessionId,
		})) {
			printStreamEvent(event);
		}
		return;
	}
	const result = await client.agents.run({
		agentId,
		input: opts.input,
		sessionId: opts.sessionId,
	});
	printRunResult(result);
}

async function runHosted(opts: {
	agentId: string;
	input: string;
	sessionId?: string;
	stream: boolean;
}): Promise<void> {
	const client = await requireHostedClient();
	if (opts.stream) {
		for await (const event of client.agents.stream({
			agentId: opts.agentId,
			input: opts.input,
			sessionId: opts.sessionId,
		})) {
			printStreamEvent(event);
		}
		return;
	}
	const result = await client.agents.run({
		agentId: opts.agentId,
		input: opts.input,
		sessionId: opts.sessionId,
	});
	printRunResult(result);
}

function printRunResult(result: {
	output: unknown;
	state?: unknown;
	sessionId?: string;
	replies?: Array<{ text: string }>;
}): void {
	const out =
		typeof result.output === "string"
			? result.output
			: formatJson(result.output);
	process.stdout.write(out);
	if (!out.endsWith("\n")) process.stdout.write("\n");
	if (result.replies && result.replies.length > 0) {
		for (const r of result.replies) {
			process.stderr.write(`\n[reply] ${r.text}\n`);
		}
	}
	if (result.sessionId) {
		process.stderr.write(`\n--- session ${result.sessionId}\n`);
	}
}

function printStreamEvent(event: StreamEvent): void {
	switch (event.type) {
		case "reply":
			process.stdout.write(`[reply] ${event.text}\n`);
			return;
		case "complete": {
			const out =
				typeof event.output === "string"
					? event.output
					: formatJson(event.output);
			process.stdout.write(`\n${out}\n`);
			return;
		}
		case "error":
			process.stderr.write(`\n[error] ${event.error}\n`);
			return;
		default:
			return;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// runs — hosted run management
// ─────────────────────────────────────────────────────────────────────────────

async function cmdRuns(args: string[]): Promise<void> {
	const [sub, ...rest] = args;
	if (!sub) fail("Usage: agntz runs <list|get|stream|cancel> [args]");

	switch (sub) {
		case "list":
			await runsList(rest);
			return;
		case "get":
			await runsGet(rest);
			return;
		case "stream":
			await runsStream(rest);
			return;
		case "cancel":
			await runsCancel(rest);
			return;
		default:
			fail(`Unknown 'runs' subcommand: ${sub}`);
	}
}

async function runsList(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			agent: { type: "string" },
			status: { type: "string" },
			limit: { type: "string" },
			cursor: { type: "string" },
		},
		allowPositionals: false,
		strict: true,
	});
	const client = await requireHostedClient();
	const result = await client.runs.list({
		agentId: values.agent,
		status: values.status as never,
		limit: values.limit ? Number(values.limit) : undefined,
		cursor: values.cursor,
	});
	process.stdout.write(`${formatJson(result)}\n`);
}

async function runsGet(args: string[]): Promise<void> {
	const [runId] = args;
	if (!runId) fail("Usage: agntz runs get <runId>");
	const client = await requireHostedClient();
	const run = await client.runs.get(runId);
	process.stdout.write(`${formatJson(run)}\n`);
}

async function runsStream(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: { since: { type: "string" } },
		allowPositionals: true,
		strict: true,
	});
	const [runId] = positionals;
	if (!runId) fail("Usage: agntz runs stream <runId> [--since <seq>]");
	const client = await requireHostedClient();
	for await (const event of client.runs.stream({
		runId,
		since: values.since ? Number(values.since) : undefined,
	})) {
		printMultiplexedRunEvent(event);
	}
}

function printMultiplexedRunEvent(event: MultiplexedRunEvent): void {
	process.stdout.write(`${formatJson(event)}\n`);
}

async function runsCancel(args: string[]): Promise<void> {
	const [runId] = args;
	if (!runId) fail("Usage: agntz runs cancel <runId>");
	const client = await requireHostedClient();
	const run = await client.runs.cancel(runId);
	process.stdout.write(`${formatJson(run)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// traces — hosted trace management
// ─────────────────────────────────────────────────────────────────────────────

async function cmdTraces(args: string[]): Promise<void> {
	const [sub, ...rest] = args;
	if (!sub) fail("Usage: agntz traces <list|get|delete> [args]");

	switch (sub) {
		case "list":
			await tracesList(rest);
			return;
		case "get":
			await tracesGet(rest);
			return;
		case "delete":
			await tracesDelete(rest);
			return;
		default:
			fail(`Unknown 'traces' subcommand: ${sub}`);
	}
}

async function tracesList(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			agent: { type: "string" },
			status: { type: "string" },
			limit: { type: "string" },
			cursor: { type: "string" },
		},
		allowPositionals: false,
		strict: true,
	});
	const client = await requireHostedClient();
	const result = await client.traces.list({
		agentId: values.agent,
		status: values.status as never,
		limit: values.limit ? Number(values.limit) : undefined,
		cursor: values.cursor,
	});
	process.stdout.write(`${formatJson(result)}\n`);
}

async function tracesGet(args: string[]): Promise<void> {
	const [traceId] = args;
	if (!traceId) fail("Usage: agntz traces get <traceId>");
	const client = await requireHostedClient();
	const trace = await client.traces.get(traceId);
	process.stdout.write(`${formatJson(trace)}\n`);
}

async function tracesDelete(args: string[]): Promise<void> {
	const [traceId] = args;
	if (!traceId) fail("Usage: agntz traces delete <traceId>");
	const client = await requireHostedClient();
	await client.traces.delete(traceId);
	log(`✓ Deleted trace ${traceId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// auth — login / logout / whoami
// ─────────────────────────────────────────────────────────────────────────────

async function cmdLogin(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			key: { type: "string" },
			url: { type: "string" },
		},
		allowPositionals: false,
		strict: true,
	});
	if (!values.key) {
		fail(
			"Usage: agntz login --key <apiKey> [--url <apiUrl>]\n\n" +
				"Browser-based login is coming in a follow-up. For now, paste an API key " +
				"from the agntz dashboard.",
		);
	}
	const config = await loadConfig();
	config.apiKey = values.key;
	if (values.url) config.apiUrl = values.url;
	await saveConfig(config);
	log(`✓ Saved credentials to ${CONFIG_PATH}`);
	log(`  API URL: ${config.apiUrl ?? DEFAULT_API_URL}`);
}

async function cmdLogout(): Promise<void> {
	if (!existsSync(CONFIG_PATH)) {
		log("Not logged in.");
		return;
	}
	await unlink(CONFIG_PATH);
	log(`✓ Removed ${CONFIG_PATH}`);
}

async function cmdWhoami(): Promise<void> {
	const config = await loadConfig();
	const envKey = process.env.AGNTZ_API_KEY;
	const apiUrl = resolveApiUrl(undefined, config);
	const key = envKey ?? config.apiKey;
	if (!key) {
		log(`Not logged in. API URL: ${apiUrl}`);
		log(`Run 'agntz login --key <key>' or set AGNTZ_API_KEY.`);
		return;
	}
	log(`API URL: ${apiUrl}`);
	log(`API key: ${maskKey(key)} (${envKey ? "from env" : "from config"})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadConfig(): Promise<CliConfig> {
	try {
		const text = await readFile(CONFIG_PATH, "utf8");
		return JSON.parse(text) as CliConfig;
	} catch {
		return {};
	}
}

async function saveConfig(config: CliConfig): Promise<void> {
	await mkdir(CONFIG_DIR, { recursive: true });
	await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
	// Restrict to owner-only — the file holds an API key.
	await chmod(CONFIG_PATH, 0o600).catch(() => {});
}

function resolveApiUrl(override?: string, config?: CliConfig): string {
	// Precedence: explicit --url flag > env var > saved config > built-in default.
	const candidates = [override, process.env.AGNTZ_API_URL, config?.apiUrl];
	for (const c of candidates) {
		if (c) return c.replace(/\/$/, "");
	}
	return DEFAULT_API_URL;
}

async function requireHostedClient(): Promise<AgntzClient> {
	const config = await loadConfig();
	const apiKey = process.env.AGNTZ_API_KEY ?? config.apiKey;
	const baseUrl = resolveApiUrl(undefined, config);
	if (!apiKey) {
		fail(
			`Not logged in. Run 'agntz login --key <key>' or set AGNTZ_API_KEY.\n(API URL: ${baseUrl})`,
		);
	}
	return new AgntzClient({ apiKey, baseUrl });
}

async function resolveInput(
	flagInput: string | undefined,
	trailingInput: string,
): Promise<string> {
	if (flagInput && flagInput !== "-") return flagInput;
	if (flagInput === "-") return await readStdin();
	if (trailingInput) return trailingInput;
	// If stdin is piped (not a TTY) and no explicit input was given, consume it.
	if (!process.stdin.isTTY) return await readStdin();
	return "";
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf8").trim();
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function relPath(absPath: string): string {
	const cwd = process.cwd();
	return absPath.startsWith(cwd)
		? `./${absPath.slice(cwd.length + 1)}`
		: absPath;
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function maskKey(key: string): string {
	if (key.length <= 8) return "***";
	return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

function formatError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function log(msg: string): void {
	process.stderr.write(`${msg}\n`);
}

function fail(msg: string): never {
	process.stderr.write(`${msg}\n`);
	process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// spinner
// ─────────────────────────────────────────────────────────────────────────────

interface SpinnerStep {
	ms: number;
	label: string;
}

/**
 * Cycling spinner with timed labels. The agent-builder pipeline takes ~15–30s
 * and we don't currently stream progress events, so labels are time-based
 * estimates rather than live state. `stop("fail")` shows a red mark; default
 * stop clears the line entirely so the next stdout write isn't garbled.
 */
function startSpinner(steps: SpinnerStep[]): (status?: "ok" | "fail") => void {
	if (!process.stderr.isTTY) {
		return (_status?: "ok" | "fail") => {};
	}
	const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	const started = Date.now();
	let frameIdx = 0;
	const interval = setInterval(() => {
		const elapsed = Date.now() - started;
		const current = steps.reduce<SpinnerStep | undefined>(
			(acc, s) => (elapsed >= s.ms ? s : acc),
			undefined,
		);
		const label = current?.label ?? "Working";
		const seconds = Math.floor(elapsed / 1000);
		process.stderr.write(`\r\x1b[K${frames[frameIdx]} ${label}… ${seconds}s`);
		frameIdx = (frameIdx + 1) % frames.length;
	}, 80);
	return (status?: "ok" | "fail") => {
		clearInterval(interval);
		process.stderr.write("\r\x1b[K");
		if (status === "fail") process.stderr.write("✗ Failed\n");
	};
}

main().catch((err) => {
	process.stderr.write(`${formatError(err)}\n`);
	process.exit(1);
});
