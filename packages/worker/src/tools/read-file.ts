import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineTool } from "@agent-runner/core";
import { z } from "zod";

const DOCS_DIR = process.env.DOCS_DIR ?? "./docs";

/**
 * Local tool: read_file
 * Reads a file from the configured docs directory and returns its contents.
 */
export const readFileTool = defineTool({
  name: "read_file",
  description: "Read a documentation file and return its contents as a string",
  input: z.object({
    path: z.string().describe("File path relative to the docs directory"),
  }),
  async execute(input: { path: string }) {
    const filePath = resolve(DOCS_DIR, input.path);

    // Prevent directory traversal
    const resolvedDocs = resolve(DOCS_DIR);
    if (!filePath.startsWith(resolvedDocs)) {
      throw new Error(`Access denied: path must be within ${DOCS_DIR}`);
    }

    const content = await readFile(filePath, "utf-8");
    return content;
  },
});
