import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@agntz/core";
import { z } from "zod";

// tsup bundles this into dist/chunk-*.js, so __dirname at runtime is the
// worker package's dist/ directory. Resolve INTO defaults/ — don't walk
// up, or you end up outside dist/ (where nothing is copied).
const __dirname = dirname(fileURLToPath(import.meta.url));

// Bundled system agents share the agent-builder reference directory for the
// manifest schema docs. If future system agents need private assets, generalize
// this — e.g. resolve relative to the calling agent's YAML directory.
const REFS_DIR = resolve(__dirname, "defaults/agents/agent-builder");

export const readFileTool = defineTool({
	name: "read_file",
	description:
		"Read a bundled reference file and return its contents as a string",
	input: z.object({
		path: z
			.string()
			.describe("File path relative to the bundled references directory"),
	}),
	async execute(input: { path: string }) {
		const filePath = resolve(REFS_DIR, input.path);

		if (!filePath.startsWith(REFS_DIR)) {
			throw new Error(`Access denied: path must be within ${REFS_DIR}`);
		}

		return readFile(filePath, "utf-8");
	},
});
