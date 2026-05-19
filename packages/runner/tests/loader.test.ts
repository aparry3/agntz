import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifestsFromDir, parseManifestString } from "../src/loader.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures/agents");

describe("loadManifestsFromDir", () => {
  it("loads YAML files keyed by agent id", async () => {
    const map = await loadManifestsFromDir(fixturesDir);
    expect([...map.keys()].sort()).toEqual(["calc-agent", "echo"]);
    expect(map.get("echo")?.kind).toBe("llm");
  });

  it("throws when the directory does not exist", async () => {
    await expect(loadManifestsFromDir("/nonexistent/path")).rejects.toThrow(/does not exist/);
  });

  it("throws a descriptive error on invalid YAML", async () => {
    expect(() => parseManifestString("not: valid: yaml: at all:")).toThrow();
  });

  it("throws when two manifests share an id", async () => {
    // Use a temp dir with two duplicate files
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const tmp = mkdtempSync(join(tmpdir(), "runner-dup-"));
    mkdirSync(join(tmp, "sub"), { recursive: true });
    const yaml = `id: dup\nkind: llm\nmodel: { provider: openai, name: gpt-5.4 }\ninstruction: hi\n`;
    writeFileSync(join(tmp, "a.yaml"), yaml);
    writeFileSync(join(tmp, "sub", "b.yaml"), yaml);
    await expect(loadManifestsFromDir(tmp)).rejects.toThrow(/Duplicate agent id 'dup'/);
  });
});
