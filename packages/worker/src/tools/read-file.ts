import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineTool } from "@agntz/core";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The only caller today is the agent-builder system agent, whose prompt
// assets (schema-reference.md, etc.) ship next to its manifest.yaml. If a
// second system agent later needs its own bundled references, generalize
// this — e.g. resolve relative to the calling agent's YAML directory.
const DEFAULT_REFS_DIR = resolve(__dirname, "../defaults/agents/agent-builder");
const REFS_DIR = process.env.DOCS_DIR ?? DEFAULT_REFS_DIR;

export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a bundled reference file and return its contents as a string",
  input: z.object({
    path: z.string().describe("File path relative to the bundled references directory"),
  }),
  async execute(input: { path: string }) {
    const filePath = resolve(REFS_DIR, input.path);

    const resolvedRoot = resolve(REFS_DIR);
    if (!filePath.startsWith(resolvedRoot)) {
      throw new Error(`Access denied: path must be within ${REFS_DIR}`);
    }

    return readFile(filePath, "utf-8");
  },
});
