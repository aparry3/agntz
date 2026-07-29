import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "agntz-packed-consumer-"));
const packs = join(temp, "packs");
const consumer = join(temp, "consumer");
const packageDirs = [
	"contracts",
	"client",
	"db",
	"core",
	"stores",
	"memrez",
	"sdk",
];

try {
	const tarballs = new Map(
		packageDirs.map((name) => {
			const output = run("pnpm", ["pack", "--pack-destination", packs], {
				cwd: join(repoRoot, "packages", name),
			});
			const tarball = output
				.trim()
				.split("\n")
				.findLast((line) => line.endsWith(".tgz"));
			if (!tarball || !existsSync(tarball)) {
				throw new Error(`Could not locate packed tarball for @agntz/${name}`);
			}
			return [name, tarball];
		}),
	);

	writeFileSync(
		join(temp, "package.json"),
		JSON.stringify({ private: true, workspaces: ["consumer"] }, null, 2),
	);
	mkdirSync(consumer);
	writeFileSync(
		join(consumer, "package.json"),
		JSON.stringify(
			{
				name: "agntz-packed-consumer",
				private: true,
				type: "module",
				scripts: { typecheck: "tsc --noEmit" },
			},
			null,
			2,
		),
	);
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"typescript@^5.9.0",
			...tarballs
				.entries()
				.filter(([name]) => name !== "memrez")
				.map(([, tarball]) => tarball),
		],
		{ cwd: consumer },
	);
	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify(
			{
				compilerOptions: {
					strict: true,
					target: "ES2022",
					module: "NodeNext",
					moduleResolution: "NodeNext",
					skipLibCheck: false,
				},
				include: ["*.ts"],
			},
			null,
			2,
		),
	);
	writeFileSync(
		join(consumer, "index.ts"),
		`import { agntz, type AgntzLocalOptions, type MemrezLike } from "@agntz/sdk";
import { parseManifest } from "@agntz/core/manifest";

const options = { agents: "./agents" } satisfies AgntzLocalOptions;
const optionalMemory: MemrezLike | undefined = undefined;
const manifest = parseManifest("id: hello\\nkind: llm\\nmodel: { provider: openai, name: gpt-5.4 }\\ninstruction: Hello");

void agntz;
void options;
void optionalMemory;
void manifest;
`,
	);
	writeFileSync(
		join(consumer, "adapters.ts"),
		`import { createPostgresPool } from "@agntz/db/postgres";
import { createSqliteDatabase } from "@agntz/db/sqlite";
import { PostgresStore } from "@agntz/stores/postgres";
import { SqliteStore } from "@agntz/stores/sqlite";

void createPostgresPool;
void createSqliteDatabase;
void PostgresStore;
void SqliteStore;
`,
	);
	run("npm", ["run", "typecheck"], { cwd: consumer });

	const runtime = run(
		"node",
		[
			"--input-type=module",
			"-e",
			`import { agntz } from "@agntz/sdk";
import schema from "@agntz/core/schema" with { type: "json" };
if (typeof agntz !== "function") throw new Error("SDK runtime export missing");
if (schema.$id !== "https://agntz.co/schemas/agent-manifest.schema.json") throw new Error("Schema export missing");
try {
  await import("@agntz/memrez");
  throw new Error("Optional @agntz/memrez was installed unexpectedly");
} catch (error) {
  if (String(error).includes("installed unexpectedly")) throw error;
}
process.stdout.write("packed consumer ok\\n");`,
		],
		{ cwd: consumer },
	);
	process.stdout.write(runtime);
	run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			tarballs.get("memrez"),
		],
		{ cwd: consumer },
	);
	writeFileSync(
		join(consumer, "memrez.ts"),
		`import { createMemrez, type Memrez } from "@agntz/memrez";

const memory: Memrez = createMemrez();
void memory;
`,
	);
	run("npm", ["run", "typecheck"], { cwd: consumer });
	run(
		"node",
		[
			"--input-type=module",
			"-e",
			`import { createMemrez } from "@agntz/memrez";
if (typeof createMemrez !== "function") throw new Error("memrez runtime export missing");`,
		],
		{ cwd: consumer },
	);

	const sdkPackage = JSON.parse(
		readFileSync(join(temp, "node_modules/@agntz/sdk/package.json"), "utf8"),
	);
	process.stdout.write(`validated @agntz/sdk@${sdkPackage.version}\n`);
} finally {
	rmSync(temp, { recursive: true, force: true });
}

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
		...options,
	});
}
