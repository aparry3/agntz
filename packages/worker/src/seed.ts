import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Runner } from "@agent-runner/core";
import { parseManifest } from "@agent-runner/manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULTS_DIR = resolve(__dirname, "defaults/agents");
const EXTRA_DIR = process.env.BUILT_IN_AGENTS_DIR;

const seededWorkspaces = new Set<string>();

/**
 * Seed default agents (e.g. agent-builder) into a workspace if not already
 * present. Idempotent: tracks seeded workspaces in-process, and double-checks
 * the store for each agent before inserting (handles process restarts).
 */
export async function seedDefaultsForWorkspace(runner: Runner, workspaceId: string): Promise<void> {
  if (seededWorkspaces.has(workspaceId)) return;

  await seedFromDirectory(runner, DEFAULTS_DIR);
  if (EXTRA_DIR) {
    await seedFromDirectory(runner, EXTRA_DIR);
  }

  seededWorkspaces.add(workspaceId);
}

async function seedFromDirectory(runner: Runner, dir: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return;
  }

  const yamlFiles = files.filter((f) => extname(f) === ".yaml" || extname(f) === ".yml");

  for (const file of yamlFiles) {
    try {
      const content = await readFile(resolve(dir, file), "utf-8");
      const manifest = parseManifest(content);

      const existing = await runner.agents.getAgent(manifest.id);
      if (existing) continue;

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
