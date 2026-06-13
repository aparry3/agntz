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
import {
	chmod,
	mkdir,
	readFile,
	readdir,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { AgntzClient } from "@agntz/client";
import type {
	AgentImportItem,
	AgentImportResponse,
	MemoryEntry,
	MemoryImportResponse,
	MultiplexedRunEvent,
	SessionImportResponse,
	SessionSnapshot,
	StreamEvent,
} from "@agntz/client";
import {
	type ManifestSelection,
	findSelectionsByAgentId,
} from "@agntz/manifest";
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
  agntz publish --dry-run
  agntz run ./agents/email.yaml --input "..." --stream

Commands:
  create   Generate a YAML manifest from a description (no auth required)
  edit     Revise a local YAML manifest from a change request (no auth required)
  run      Execute a local YAML/dir or hosted agent id
  publish  Publish local agents, sessions, and memory to hosted agntz
  login    Save hosted API credentials
  logout   Remove saved hosted API credentials
  whoami   Show resolved API URL and credential source
  eval     Run and inspect hosted evals
  runs     List, inspect, stream, or cancel hosted runs
  traces   List, inspect, or delete hosted traces

Help:
  agntz <command> --help
  agntz publish --help
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

const PUBLISH_HELP = `agntz publish — publish local data to hosted agntz

Usage:
  agntz publish [all|agents|sessions|memory...] [options]

Description:
  Publishes local agent manifests, persisted sessions, and memrez memory into
  your hosted agntz account. With no entities, defaults to "all".

Entities:
  all        Publish every discoverable entity type
  agents    YAML manifests from --agents-dir
  sessions  Sessions from a local agntz SQLite store
  memory    Entries from a local memrez SQLite store

Options:
      --agents-dir <dir>  Agent manifest directory. Default: ./agents
      --db <path>         Local agntz SQLite store for sessions. Default: ./agntz.db if present
      --memory-db <path>  Local memrez SQLite store. Default: ./memory.db or ./memrez.db if present
      --dry-run           Validate and show what would publish without writing
      --yes               Skip the confirmation prompt
      --skip-existing     Skip existing hosted agents instead of creating new versions
      --fail-existing     Fail if a hosted agent or session already exists
      --include-superseded Include superseded memory entries
      --url <apiUrl>      Override hosted API URL for this call
      --json              Print machine-readable JSON
  -h, --help              Show this help

Examples:
  agntz publish --dry-run
  agntz publish --yes
  agntz publish agents --agents-dir ./bots
  agntz publish sessions --db ./agntz.db
  agntz publish memory --memory-db ./memory.db
  agntz publish agents sessions memory --dry-run
`;

const EDIT_HELP = `agntz edit — revise a local agent YAML manifest

Usage:
  agntz edit <manifest.yaml> "<change request>" [options]

Description:
  Calls the hosted agent-editor with the current YAML draft. The editor returns
  a complete updated YAML manifest. This command does not require login.

Options:
  -o, --output <path>    Write the edited YAML to a specific path
      --write            Overwrite the input manifest
      --select <agentId> Focus the edit on one block by agent id
      --url <apiUrl>     Override the editor API URL for this call
  -h, --help             Show this help

Examples:
  agntz edit ./agents/support.yaml "make the tone more concise" --write
  agntz edit ./agents/pipeline.yaml "change the classifier output to include urgency" --select classifier -o ./agents/pipeline.yaml
  agntz edit ./agents/support.yaml "add an input field for account id" > ./agents/support.next.yaml
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
		case "edit":
			await cmdEdit(rest);
			return;
		case "run":
			await cmdRun(rest);
			return;
		case "publish":
			await cmdPublish(rest);
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
	const currentManifest = values["current-manifest"]
		? await readFile(resolve(values["current-manifest"]), "utf8").catch(
				(err) => {
					fail(
						`Could not read --current-manifest ${values["current-manifest"]}: ${formatError(err)}`,
					);
				},
			)
		: undefined;
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
			currentManifest,
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
// edit — call the public /edit-agent endpoint with a local YAML draft
// ─────────────────────────────────────────────────────────────────────────────

async function cmdEdit(args: string[]): Promise<void> {
	if (wantsHelp(args)) {
		process.stdout.write(EDIT_HELP);
		return;
	}

	const { values, positionals } = parseArgs({
		args,
		options: {
			output: { type: "string", short: "o" },
			write: { type: "boolean", default: false },
			select: { type: "string" },
			url: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});

	const [manifestPathRaw, ...changeParts] = positionals;
	const changeDescription = changeParts.join(" ").trim();
	if (!manifestPathRaw || !changeDescription) {
		fail('Usage: agntz edit <manifest.yaml> "<change request>"');
	}
	if (values.write && values.output) {
		fail("Use either --write or --output, not both.");
	}

	const manifestPath = resolve(manifestPathRaw);
	const currentManifest = await readFile(manifestPath, "utf8").catch((err) => {
		fail(`Could not read ${manifestPathRaw}: ${formatError(err)}`);
	});

	let selection: ManifestSelection | undefined;
	if (values.select) {
		const manifest = parseManifestString(currentManifest);
		const matches = findSelectionsByAgentId(manifest, values.select);
		if (matches.length === 0) {
			fail(
				`No block with id or ref "${values.select}" found in ${manifestPathRaw}.`,
			);
		}
		if (matches.length > 1) {
			fail(
				`Selection "${values.select}" matched ${matches.length} blocks. Use a unique agent id before running agntz edit --select.`,
			);
		}
		selection = matches[0];
	}

	const apiUrl = resolveApiUrl(values.url);
	const stopSpinner = startSpinner([
		{ ms: 0, label: "Reading YAML" },
		{ ms: 4000, label: "Editing draft" },
		{ ms: 14000, label: "Validating" },
		{ ms: 22000, label: "Finalizing" },
	]);

	let response: EditAgentResponse;
	try {
		response = await callEditAgent({
			apiUrl,
			currentManifest,
			changeDescription,
			selection,
		});
	} catch (err) {
		stopSpinner("fail");
		fail(formatError(err));
	} finally {
		stopSpinner();
	}

	if (!response.yaml) {
		fail(
			`Agent editor did not return a YAML manifest.${response.validation ? `\nValidation:\n${formatJson(response.validation)}` : ""}`,
		);
	}

	if (values.write || values.output) {
		const outPath = values.write ? manifestPath : resolve(values.output ?? "");
		await mkdir(dirname(outPath), { recursive: true });
		await writeFile(outPath, response.yaml);
		log(`✓ Wrote ${relPath(outPath)}`);
		if (response.explanation) log(`\n${response.explanation.trim()}`);
		return;
	}

	process.stdout.write(response.yaml);
	if (!response.yaml.endsWith("\n")) process.stdout.write("\n");
}

interface EditAgentResponse {
	yaml: string | null;
	explanation: string | null;
	validation: unknown;
}

async function callEditAgent(opts: {
	apiUrl: string;
	currentManifest: string;
	changeDescription: string;
	selection?: ManifestSelection;
}): Promise<EditAgentResponse> {
	const url = joinUrl(opts.apiUrl, "/edit-agent");
	const body: Record<string, unknown> = {
		currentManifest: opts.currentManifest,
		changeDescription: opts.changeDescription,
	};
	if (opts.selection) body.selection = opts.selection;

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
	return (await res.json()) as EditAgentResponse;
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

// ─────────────────────────────────────────────────────────────────────────────
// publish — migrate local agents/sessions/memory to hosted agntz
// ─────────────────────────────────────────────────────────────────────────────

type PublishEntity = "agents" | "sessions" | "memory";
type PublishAction = "create" | "version" | "skip" | "update";

interface PublishSkipped {
	entity: PublishEntity;
	reason: string;
}

interface PublishOutput {
	dryRun: boolean;
	entities: PublishEntity[];
	skipped: PublishSkipped[];
	agents?: AgentImportResponse;
	sessions?: SessionImportResponse;
	memory?: MemoryImportResponse;
}

async function cmdPublish(args: string[]): Promise<void> {
	if (wantsHelp(args)) {
		process.stdout.write(PUBLISH_HELP);
		return;
	}

	const { values, positionals } = parseArgs({
		args,
		options: {
			"agents-dir": { type: "string" },
			db: { type: "string" },
			"memory-db": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			yes: { type: "boolean", default: false },
			"skip-existing": { type: "boolean", default: false },
			"fail-existing": { type: "boolean", default: false },
			"include-superseded": { type: "boolean", default: false },
			url: { type: "string" },
			json: { type: "boolean", default: false },
		},
		allowPositionals: true,
		strict: true,
	});

	if (values["skip-existing"] && values["fail-existing"]) {
		fail("Use either --skip-existing or --fail-existing, not both.");
	}

	const parsed = parsePublishEntities(positionals);
	const entities = parsed.entities;
	const explicitEntities = parsed.explicitEntities;
	const dryRun = values["dry-run"] === true;
	const json = values.json === true;
	const skipped: PublishSkipped[] = [];
	const sources: {
		agents?: AgentImportItem[];
		sessions?: SessionSnapshot[];
		memory?: MemoryEntry[];
	} = {};

	if (entities.includes("agents")) {
		const agentsDir = resolve(values["agents-dir"] ?? "agents");
		if (existsSync(agentsDir)) {
			sources.agents = await readLocalAgentImports(agentsDir);
			if (sources.agents.length === 0) {
				skipped.push({
					entity: "agents",
					reason: `no YAML manifests found in ${relPath(agentsDir)}`,
				});
			}
		} else if (explicitEntities.has("agents")) {
			fail(`Agent directory not found: ${relPath(agentsDir)}`);
		} else {
			skipped.push({
				entity: "agents",
				reason: `no ${relPath(agentsDir)} directory found`,
			});
		}
	}

	if (entities.includes("sessions")) {
		const dbPath = resolveLocalDbPath(values.db);
		if (dbPath) {
			sources.sessions = await readLocalSessionSnapshots(dbPath);
			if (sources.sessions.length === 0) {
				skipped.push({
					entity: "sessions",
					reason: `no sessions found in ${relPath(dbPath)}`,
				});
			}
		} else if (explicitEntities.has("sessions")) {
			fail("No local session store found. Pass --db ./agntz.db.");
		} else {
			skipped.push({
				entity: "sessions",
				reason: "no local session store found; pass --db ./agntz.db",
			});
		}
	}

	if (entities.includes("memory")) {
		const memoryDbPath = resolveLocalMemoryDbPath(values["memory-db"]);
		if (memoryDbPath) {
			sources.memory = await readLocalMemoryEntries(memoryDbPath, {
				includeSuperseded: values["include-superseded"] === true,
			});
			if (sources.memory.length === 0) {
				skipped.push({
					entity: "memory",
					reason: `no memory entries found in ${relPath(memoryDbPath)}`,
				});
			}
		} else if (explicitEntities.has("memory")) {
			fail("No local memory store found. Pass --memory-db ./memory.db.");
		} else {
			skipped.push({
				entity: "memory",
				reason: "no local memory store found; pass --memory-db ./memory.db",
			});
		}
	}

	const plannedCount =
		(sources.agents?.length ?? 0) +
		(sources.sessions?.length ?? 0) +
		(sources.memory?.length ?? 0);
	if (plannedCount === 0) {
		if (json) {
			process.stdout.write(
				`${formatJson({ dryRun, entities, skipped, counts: {} })}\n`,
			);
			return;
		}
		fail(
			`Nothing to publish.\n${skipped.map((s) => `- ${s.entity}: ${s.reason}`).join("\n")}`,
		);
	}

	if (!dryRun && !values.yes) {
		await confirmPublishOrExit(sources);
	}

	const client = await requireHostedClient(values.url);
	const output: PublishOutput = { dryRun, entities, skipped };
	const agentConflict = values["fail-existing"]
		? "fail"
		: values["skip-existing"]
			? "skip"
			: "version";
	const snapshotConflict = values["fail-existing"] ? "fail" : "skip";

	if (sources.agents?.length) {
		output.agents = await client.agents.import({
			agents: sources.agents,
			onConflict: agentConflict,
			dryRun,
		});
	}
	if (sources.sessions?.length) {
		output.sessions = await client.sessions.import({
			sessions: sources.sessions,
			onConflict: snapshotConflict,
			dryRun,
		});
	}
	if (sources.memory?.length) {
		output.memory = await client.memory.import({
			entries: sources.memory,
			dryRun,
		});
	}

	if (json) {
		process.stdout.write(`${formatJson(output)}\n`);
		return;
	}
	printPublishOutput(output);
}

function parsePublishEntities(positionals: string[]): {
	entities: PublishEntity[];
	explicitEntities: Set<PublishEntity>;
} {
	const requested = positionals.length === 0 ? ["all"] : positionals;
	const explicitEntities = new Set<PublishEntity>();
	const selected = new Set<PublishEntity>();
	for (const raw of requested) {
		const normalized = normalizePublishEntity(raw);
		if (normalized === "all") {
			selected.add("agents");
			selected.add("sessions");
			selected.add("memory");
			continue;
		}
		selected.add(normalized);
		explicitEntities.add(normalized);
	}
	const order: PublishEntity[] = ["agents", "sessions", "memory"];
	return {
		entities: order.filter((entity) => selected.has(entity)),
		explicitEntities,
	};
}

function normalizePublishEntity(value: string): PublishEntity | "all" {
	const normalized = value.toLowerCase();
	if (normalized === "all") return "all";
	if (normalized === "agent" || normalized === "agents") return "agents";
	if (normalized === "session" || normalized === "sessions") return "sessions";
	if (
		normalized === "memory" ||
		normalized === "memories" ||
		normalized === "memrez"
	) {
		return "memory";
	}
	const suggestion = suggestPublishEntity(normalized);
	fail(
		`Unknown publish entity "${value}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
	);
}

function suggestPublishEntity(value: string): string | null {
	const known = ["all", "agents", "sessions", "memory", "memories"];
	let best: { value: string; distance: number } | null = null;
	for (const candidate of known) {
		const distance = editDistance(value, candidate);
		if (!best || distance < best.distance)
			best = { value: candidate, distance };
	}
	return best && best.distance <= 2 ? best.value : null;
}

function editDistance(a: string, b: string): number {
	const dp = Array.from({ length: a.length + 1 }, () =>
		Array.from({ length: b.length + 1 }, () => 0),
	);
	for (let i = 0; i <= a.length; i++) dp[i][0] = i;
	for (let j = 0; j <= b.length; j++) dp[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			dp[i][j] = Math.min(
				dp[i - 1][j] + 1,
				dp[i][j - 1] + 1,
				dp[i - 1][j - 1] + cost,
			);
		}
	}
	return dp[a.length][b.length];
}

async function readLocalAgentImports(dir: string): Promise<AgentImportItem[]> {
	const files = await collectYamlFiles(dir);
	const seen = new Map<string, string>();
	const agents: AgentImportItem[] = [];
	for (const file of files) {
		const source = await readFile(file, "utf8");
		const manifest = await loadManifestFromFile(file);
		const previous = seen.get(manifest.id);
		if (previous) {
			fail(
				`Duplicate agent id "${manifest.id}" in ${relPath(previous)} and ${relPath(file)}.`,
			);
		}
		seen.set(manifest.id, file);
		agents.push({
			id: manifest.id,
			manifest: source,
			sourcePath: relPath(file),
		});
	}
	return agents;
}

async function collectYamlFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	const entries = await readdir(dir);
	for (const entry of entries) {
		const full = join(dir, entry);
		const st = await stat(full);
		if (st.isDirectory()) {
			out.push(...(await collectYamlFiles(full)));
		} else if (st.isFile()) {
			const ext = extname(entry).toLowerCase();
			if (ext === ".yaml" || ext === ".yml") out.push(full);
		}
	}
	return out.sort();
}

function resolveLocalDbPath(override?: string): string | null {
	if (override) return resolve(override);
	const candidate = resolve("agntz.db");
	return existsSync(candidate) ? candidate : null;
}

function resolveLocalMemoryDbPath(override?: string): string | null {
	if (override) return resolve(override);
	for (const name of ["memory.db", "memrez.db"]) {
		const candidate = resolve(name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

interface LocalSessionStore {
	listSessions(agentId?: string): Promise<
		Array<{
			sessionId: string;
			agentId?: string;
			createdAt: string;
			updatedAt: string;
		}>
	>;
	getMessages(sessionId: string): Promise<SessionSnapshot["messages"]>;
}

async function readLocalSessionSnapshots(
	dbPath: string,
): Promise<SessionSnapshot[]> {
	let imported: {
		SqliteStore: new (opts: { path: string }) => {
			forUser(userId: string): LocalSessionStore;
			close(): void;
		};
	};
	try {
		imported = (await import("@agntz/store-sqlite")) as typeof imported;
	} catch {
		fail(
			"Session publishing requires @agntz/store-sqlite to be installed alongside @agntz/sdk.",
		);
	}
	const admin = new imported.SqliteStore({ path: dbPath });
	try {
		const store = admin.forUser("embedded");
		const summaries = await store.listSessions();
		const snapshots: SessionSnapshot[] = [];
		for (const summary of summaries) {
			snapshots.push({
				sessionId: summary.sessionId,
				agentId: summary.agentId,
				createdAt: summary.createdAt,
				updatedAt: summary.updatedAt,
				messages: await store.getMessages(summary.sessionId),
			});
		}
		return snapshots;
	} finally {
		admin.close();
	}
}

async function readLocalMemoryEntries(
	dbPath: string,
	opts: { includeSuperseded: boolean },
): Promise<MemoryEntry[]> {
	let imported: {
		SqliteMemoryStore: new (
			path: string,
		) => {
			listEntries(opts?: { includeSuperseded?: boolean }): Promise<
				MemoryEntry[]
			>;
			close(): void;
		};
	};
	try {
		imported = (await import("@agntz/memrez")) as typeof imported;
	} catch {
		fail(
			"Memory publishing requires @agntz/memrez to be installed alongside @agntz/sdk.",
		);
	}
	const store = new imported.SqliteMemoryStore(dbPath);
	try {
		return await store.listEntries({
			includeSuperseded: opts.includeSuperseded,
		});
	} finally {
		store.close();
	}
}

async function confirmPublishOrExit(sources: {
	agents?: AgentImportItem[];
	sessions?: SessionSnapshot[];
	memory?: MemoryEntry[];
}): Promise<void> {
	if (!process.stdin.isTTY) {
		fail("Refusing to publish without --yes because stdin is not interactive.");
	}
	const summary = [
		`agents=${sources.agents?.length ?? 0}`,
		`sessions=${sources.sessions?.length ?? 0}`,
		`memory=${sources.memory?.length ?? 0}`,
	].join(", ");
	const rl = createInterface({ input: process.stdin, output: process.stderr });
	try {
		const answer = await rl.question(`Publish ${summary}? [y/N] `);
		if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
			fail("Publish cancelled.");
		}
	} finally {
		rl.close();
	}
}

function printPublishOutput(output: PublishOutput): void {
	const mode = output.dryRun ? "Dry run complete" : "Publish complete";
	log(mode);
	if (output.skipped.length > 0) {
		for (const skipped of output.skipped) {
			log(`- ${skipped.entity}: skipped (${skipped.reason})`);
		}
	}
	if (output.agents) printEntityImport("agents", output.agents);
	if (output.sessions) printEntityImport("sessions", output.sessions);
	if (output.memory) printEntityImport("memory", output.memory);
	if (output.dryRun) log("\nRun again with --yes to publish.");
}

function printEntityImport(
	entity: string,
	response: {
		results: Array<{ action: string; warnings?: unknown[] }>;
		counts: Record<string, number>;
	},
): void {
	const counts = formatActionCounts(response.counts);
	const warnings = response.results.reduce(
		(total, result) => total + (result.warnings?.length ?? 0),
		0,
	);
	log(
		`- ${entity}: ${response.results.length} found${counts ? ` (${counts})` : ""}${warnings ? `, ${warnings} warning(s)` : ""}`,
	);
}

function formatActionCounts(counts: Record<string, number>): string {
	const order: PublishAction[] = ["create", "version", "update", "skip"];
	return order
		.filter((action) => counts[action])
		.map((action) => `${counts[action]} ${action}`)
		.join(", ");
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

async function requireHostedClient(
	apiUrlOverride?: string,
): Promise<AgntzClient> {
	const config = await loadConfig();
	const apiKey = process.env.AGNTZ_API_KEY ?? config.apiKey;
	const baseUrl = resolveApiUrl(apiUrlOverride, config);
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
