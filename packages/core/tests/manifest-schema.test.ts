import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { validateManifest } from "../src/manifest/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const schemaPath = resolve(here, "../schema/agent-manifest.schema.json");

describe("agent manifest JSON Schema", () => {
	it("is a valid draft-2020 schema and accepts repository manifests", async () => {
		const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
		const ajv = new Ajv2020({
			allErrors: true,
			strict: true,
			strictRequired: false,
			formats: { uri: true },
		});
		const validate = ajv.compile(schema);
		const files = (
			await Promise.all([
				collectYaml(resolve(repoRoot, "examples/agents")),
				collectYaml(resolve(repoRoot, "packages/sdk/tests/fixtures")),
				collectYaml(resolve(repoRoot, "contracts/python-port/manifests")),
				collectYaml(resolve(repoRoot, "packages/worker/src/defaults/agents")),
			])
		).flat();
		expect(files.length).toBeGreaterThan(0);

		for (const file of files) {
			const yaml = await readFile(file, "utf8");
			const runtimeResult = validateManifest(yaml);
			expect(runtimeResult.errors, file).toEqual([]);
			expect(runtimeResult.valid, file).toBe(true);

			const valid = validate(parseYaml(yaml));
			expect(validate.errors, file).toBeNull();
			expect(valid, file).toBe(true);
		}
	});

	it("matches runtime requirements for deterministic tool and schema fields", async () => {
		const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
		const validate = new Ajv2020({
			allErrors: true,
			strict: true,
			strictRequired: false,
			formats: { uri: true },
		}).compile(schema);
		const cases = [
			{
				valid: true,
				yaml: `
id: create-user
kind: tool
inputSchema:
  name: string
tool:
  kind: http
  name: create_user
  url: https://api.example.com/users
  method: POST
  body_type: json
  body:
    name: "{{name}}"
`,
			},
			{
				valid: false,
				yaml: `
id: missing-url
kind: tool
tool:
  kind: http
  name: get_user
`,
			},
			{
				valid: false,
				yaml: `
id: missing-server
kind: tool
tool:
  kind: mcp
  name: lookup
`,
			},
			{
				valid: true,
				yaml: `
id: integer-property
kind: llm
model: { provider: openai, name: gpt-5.4 }
instruction: test
inputSchema:
  count: integer
`,
			},
			{
				valid: false,
				yaml: `
id: invalid-output-map
kind: sequential
steps:
  - agent:
      id: child
      kind: llm
      model: { provider: openai, name: gpt-5.4 }
      instruction: test
output:
  result: 42
`,
			},
		];

		for (const testCase of cases) {
			const runtimeResult = validateManifest(testCase.yaml);
			const schemaResult = validate(parseYaml(testCase.yaml));
			expect(runtimeResult.valid, testCase.yaml).toBe(testCase.valid);
			expect(schemaResult, testCase.yaml).toBe(testCase.valid);
		}
	});
});

async function collectYaml(root: string): Promise<string[]> {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries
		.filter(
			(entry) =>
				entry.isFile() && [".yaml", ".yml"].includes(extname(entry.name)),
		)
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}
