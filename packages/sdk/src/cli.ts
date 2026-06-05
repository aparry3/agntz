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

const HELP = `agntz — create, run, and inspect agntz agents from the terminal

Usage:
  agntz <command> [args] [options]

Getting started locally:
  agntz create "Summarize customer emails" -o ./agents/email.yaml
  agntz run ./agents/email.yaml --input "..."
  agntz run ./agents/email.yaml --input "..." --stream

Commands:
  create   Generate a YAML manifest from a description (no auth required)
  run      Execute a local YAML/dir or hosted agent id
  login    Save hosted API credentials
  logout   Remove saved hosted API credentials
  whoami   Show resolved API URL and credential source
  eval     Run and inspect hosted evals
  runs     List, inspect, stream, or cancel hosted runs
  traces   List, inspect, or delete hosted traces

Help:
  agntz <command> --help
  agntz runs --help
  agntz eval --help
  agntz traces --help

Local vs hosted:
  Paths like ./agents/support.yaml run locally with @agntz/sdk.
  Bare ids like support require login and run against the hosted API.

Auth:
  Hosted commands read AGNTZ_API_KEY first, then ~/.agntz/config.json.
  Local runs use provider keys from your shell, such as OPENAI_API_KEY.

Environment:
  AGNTZ_API_KEY     Overrides the saved key.
  AGNTZ_API_URL     Overrides the saved URL (default ${DEFAULT_API_URL}).

Options:
  -h, --help        Show help
  -v, --version     Show version
`;

const CREATE_HELP = `agntz create — generate an agent YAML manifest

Usage:
  agntz create "<description>" [options]

Description:
  Calls the hosted agent-builder and writes a portable YAML manifest.
  This command does not require login.

Options:
  -o, --output <path>          Write YAML to a specific path
                              Default: ./agents/<generated-id>.yaml
      --stdout                Print YAML to stdout instead of writing a file
      --current-manifest <p>  Ask the builder to revise an existing manifest
      --url <apiUrl>          Override the builder API URL for this call
  -h, --help                  Show this help

Examples:
  agntz create "Answer support questions in a concise tone" -o ./agents/support.yaml
  agntz create "Add order-status lookup over HTTP" --current-manifest ./agents/support.yaml -o ./agents/support.yaml
  agntz create "Classify incoming leads" --stdout > ./agents/lead-classifier.yaml

Next:
  agntz run ./agents/support.yaml --input "How do I reset my password?"
`;

const RUN_HELP = `agntz run — execute a local or hosted agent

Usage:
  agntz run <path-or-id> [options] [input...]

Target resolution:
  ./agents/support.yaml      local YAML file
  ./agents/                  local directory, only if it contains one manifest
  support                    hosted agent id, requires login

Options:
      --input <text>         Input string. Use --input - to read stdin
      --session <id>         Reuse a session id across calls
      --stream               Stream events instead of waiting for final output
      --local                Force local execution
      --remote               Force hosted execution
  -h, --help                 Show this help

Input precedence:
  --input value > trailing positional input > piped stdin > empty string

Examples:
  agntz run ./agents/support.yaml --input "How do I reset my password?"
  echo "Summarize this" | agntz run ./agents/summarizer.yaml
  agntz run ./agents/support.yaml --session user-42 --input "follow-up" --stream
  agntz run support --input "hello" --remote

Local runtime note:
  The CLI can load YAML from disk, but it cannot register arbitrary in-repo
  local tool handlers. For agents that need local tools or resource providers,
  call @agntz/sdk from your service code and pass tools/resources there.
`;

const LOGIN_HELP = `agntz login — save hosted API credentials

Usage:
  agntz login --key <apiKey> [--url <apiUrl>]

Options:
      --key <apiKey>    API key from agntz.co or your self-hosted dashboard
      --url <apiUrl>    Hosted API base URL. Default: ${DEFAULT_API_URL}
  -h, --help            Show this help

Examples:
  agntz login --key ar_live_...
  agntz login --key ar_live_... --url https://agntz-worker.example.com

Credentials are written to ~/.agntz/config.json with owner-only permissions.
AGNTZ_API_KEY and AGNTZ_API_URL override saved config for a single command.
`;

const LOGOUT_HELP = `agntz logout — remove saved hosted API credentials

Usage:
  agntz logout

Description:
  Deletes ~/.agntz/config.json if it exists. Environment variables are not
  modified.

Options:
  -h, --help            Show this help

Example:
  agntz logout
`;

const WHOAMI_HELP = `agntz whoami — show resolved hosted API configuration

Usage:
  agntz whoami

Description:
  Prints the resolved API URL and whether an API key is available. The key is
  masked and may come from AGNTZ_API_KEY or ~/.agntz/config.json.

Options:
  -h, --help            Show this help

Example:
  AGNTZ_API_KEY=ar_live_... agntz whoami
`;

const RUNS_HELP = `agntz runs — manage hosted runs

Usage:
  agntz runs list   [--agent <id>] [--status <s>] [--limit <n>] [--cursor <c>]
  agntz runs get    <runId>
  agntz runs stream <runId> [--since <seq>]
  agntz runs cancel <runId>

Auth:
  Requires AGNTZ_API_KEY or agntz login.

Examples:
  agntz runs list --agent support --limit 20
  agntz runs get run_123
  agntz runs stream run_123 --since 10
  agntz runs cancel run_123

Output:
  JSON, suitable for piping to jq.
`;

const EVAL_HELP = `agntz eval — run and inspect hosted evals

Usage:
  agntz eval run  <evalId> [--dataset <id>] [--version <agentVersion>]
  agntz eval runs [--agent <id>] [--eval <id>] [--dataset <id>] [--status <s>] [--limit <n>] [--cursor <c>]
  agntz eval cancel <runId>
  agntz eval scores [--agent <id>] [--eval <id>] [--dataset <id>] [--version <createdAt>]
  agntz eval get  <evalId>

Auth:
  Requires AGNTZ_API_KEY or agntz login.

Examples:
  agntz eval run support-quality --dataset refund-cases
  agntz eval runs --agent support --limit 10
  agntz eval scores --eval support-quality --dataset refund-cases
  agntz eval get support-quality

Output:
  JSON, suitable for piping to jq.
`;

const TRACES_HELP = `agntz traces — manage hosted traces

Usage:
  agntz traces list   [--agent <id>] [--status <s>] [--limit <n>] [--cursor <c>]
  agntz traces get    <traceId>
  agntz traces delete <traceId>

Auth:
  Requires AGNTZ_API_KEY or agntz login.

Examples:
  agntz traces list --agent support --status failed --limit 10
  agntz traces get trace_123
  agntz traces delete trace_123

Output:
  list/get print JSON. delete prints a confirmation message.
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
			await cmdLogout(rest);
			return;
		case "whoami":
			await cmdWhoami(rest);
			return;
		case "eval":
			await cmdEval(rest);
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
	if (wantsHelp(args)) {
		process.stdout.write(CREATE_HELP);
		return;
	}

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
	if (wantsHelp(args)) {
		process.stdout.write(RUN_HELP);
		return;
	}

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
// eval — hosted eval management
// ─────────────────────────────────────────────────────────────────────────────

async function cmdEval(args: string[]): Promise<void> {
	const [sub, ...rest] = args;
	if (!sub || wantsHelp(args)) {
		process.stdout.write(EVAL_HELP);
		return;
	}

	switch (sub) {
		case "run":
			await evalRun(rest);
			return;
		case "runs":
			await evalRuns(rest);
			return;
		case "cancel":
			await evalCancel(rest);
			return;
		case "scores":
			await evalScores(rest);
			return;
		case "get":
			await evalGet(rest);
			return;
		default:
			fail(`Unknown 'eval' subcommand: ${sub}`);
	}
}

async function evalRun(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			dataset: { type: "string" },
			version: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});
	const [evalId] = positionals;
	if (!evalId) {
		fail(
			"Usage: agntz eval run <evalId> [--dataset <id>] [--version <agentVersion>]",
		);
	}
	const client = await requireHostedClient();
	const run = await client.evals.run({
		evalId,
		datasetId: values.dataset,
		agentVersion: values.version,
	});
	process.stdout.write(`${formatJson(run)}\n`);
}

async function evalRuns(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			agent: { type: "string" },
			eval: { type: "string" },
			dataset: { type: "string" },
			status: { type: "string" },
			limit: { type: "string" },
			cursor: { type: "string" },
		},
		allowPositionals: false,
		strict: true,
	});
	const client = await requireHostedClient();
	const result = await client.evals.listRuns({
		agentId: values.agent,
		evalId: values.eval,
		datasetId: values.dataset,
		status: values.status as never,
		limit: values.limit ? Number(values.limit) : undefined,
		cursor: values.cursor,
	});
	process.stdout.write(`${formatJson(result)}\n`);
}

async function evalCancel(args: string[]): Promise<void> {
	const [runId] = args;
	if (!runId) fail("Usage: agntz eval cancel <runId>");
	const client = await requireHostedClient();
	const run = await client.evals.cancelRun(runId);
	process.stdout.write(`${formatJson(run)}\n`);
}

async function evalScores(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			agent: { type: "string" },
			eval: { type: "string" },
			dataset: { type: "string" },
			version: { type: "string" },
			status: { type: "string" },
		},
		allowPositionals: false,
		strict: true,
	});
	const client = await requireHostedClient();
	const result = await client.evals.listLatestScores({
		agentId: values.agent,
		evalId: values.eval,
		datasetId: values.dataset,
		resolvedAgentVersion: values.version,
		status: values.status as never,
	});
	process.stdout.write(`${formatJson(result)}\n`);
}

async function evalGet(args: string[]): Promise<void> {
	const [evalId] = args;
	if (!evalId) fail("Usage: agntz eval get <evalId>");
	const client = await requireHostedClient();
	const definition = await client.evals.get(evalId);
	process.stdout.write(`${formatJson(definition)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// runs — hosted run management
// ─────────────────────────────────────────────────────────────────────────────

async function cmdRuns(args: string[]): Promise<void> {
	const [sub, ...rest] = args;
	if (!sub || wantsHelp(args)) {
		process.stdout.write(RUNS_HELP);
		return;
	}

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
	if (!sub || wantsHelp(args)) {
		process.stdout.write(TRACES_HELP);
		return;
	}

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
	if (wantsHelp(args)) {
		process.stdout.write(LOGIN_HELP);
		return;
	}

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

async function cmdLogout(args: string[]): Promise<void> {
	if (wantsHelp(args)) {
		process.stdout.write(LOGOUT_HELP);
		return;
	}

	if (args.length > 0) {
		fail("Usage: agntz logout");
	}

	if (!existsSync(CONFIG_PATH)) {
		log("Not logged in.");
		return;
	}
	await unlink(CONFIG_PATH);
	log(`✓ Removed ${CONFIG_PATH}`);
}

async function cmdWhoami(args: string[]): Promise<void> {
	if (wantsHelp(args)) {
		process.stdout.write(WHOAMI_HELP);
		return;
	}

	if (args.length > 0) {
		fail("Usage: agntz whoami");
	}

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

function wantsHelp(args: string[]): boolean {
	return args.includes("-h") || args.includes("--help");
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
