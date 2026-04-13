import { readdir, readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { Runner } from "@agent-runner/core";
import { parseManifest } from "@agent-runner/manifest";

const BUILT_IN_DIR = process.env.BUILT_IN_AGENTS_DIR ?? "./examples/agents";

/**
 * Seed built-in agents from YAML files into the store.
 * Only inserts agents that don't already exist (won't overwrite user edits).
 */
export async function seedBuiltInAgents(runner: Runner): Promise<void> {
  let files: string[];
  try {
    files = await readdir(BUILT_IN_DIR);
  } catch {
    // Directory doesn't exist — skip seeding
    return;
  }

  const yamlFiles = files.filter((f) => extname(f) === ".yaml" || extname(f) === ".yml");

  for (const file of yamlFiles) {
    try {
      const content = await readFile(resolve(BUILT_IN_DIR, file), "utf-8");
      const manifest = parseManifest(content);

      // Check if agent already exists
      const existing = await runner.agents.getAgent(manifest.id);
      if (existing) continue;

      // Store agent with manifest in metadata
      await runner.agents.putAgent({
        id: manifest.id,
        name: manifest.name ?? manifest.id,
        description: manifest.description,
        systemPrompt: "",
        model: { provider: "system", name: "manifest" },
        metadata: { manifest: content, builtIn: true },
      });

      console.log(`Seeded built-in agent: ${manifest.id}`);
    } catch (e) {
      console.warn(`Failed to seed ${file}: ${(e as Error).message}`);
    }
  }
}
