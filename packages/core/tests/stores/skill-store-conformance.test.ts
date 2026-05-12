import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SkillDefinition, SkillStore } from "../../src/types.js";
import { MemoryStore } from "../../src/stores/memory.js";
import { JsonFileStore } from "../../src/stores/json-file.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeSkill(overrides: Partial<SkillDefinition> & { name: string }): SkillDefinition {
  return {
    name: overrides.name,
    description: overrides.description ?? `description for ${overrides.name}`,
    instructions: overrides.instructions ?? `instructions for ${overrides.name}`,
    tools: overrides.tools,
    metadata: overrides.metadata,
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
  };
}

/**
 * Backend factory contract. Each backend returns:
 *   - storeA: a SkillStore scoped to user "u1"
 *   - storeB: a SkillStore scoped to user "u2" (sharing backing state with storeA)
 *   - cleanup: tear-down
 */
interface Factory {
  storeA: SkillStore;
  storeB: SkillStore;
  cleanup: () => void | Promise<void>;
}

export function runSkillStoreConformance(
  suiteName: string,
  factory: () => Promise<Factory>,
): void {
  describe(`${suiteName} — SkillStore conformance`, () => {
    let storeA: SkillStore;
    let storeB: SkillStore;
    let cleanup: () => void | Promise<void>;

    beforeEach(async () => {
      const made = await factory();
      storeA = made.storeA;
      storeB = made.storeB;
      cleanup = made.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    it("getSkill returns null for an unknown name", async () => {
      expect(await storeA.getSkill("nope")).toBeNull();
    });

    it("listSkills returns [] when no skills exist", async () => {
      expect(await storeA.listSkills()).toEqual([]);
    });

    it("round-trips a skill via putSkill and getSkill", async () => {
      await storeA.putSkill(
        makeSkill({
          name: "researcher",
          description: "Web research.",
          instructions: "Search broadly.",
          tools: [{ type: "inline", name: "web_search" }],
          metadata: { team: "research" },
        }),
      );
      const got = await storeA.getSkill("researcher");
      expect(got).not.toBeNull();
      expect(got!.name).toBe("researcher");
      expect(got!.description).toBe("Web research.");
      expect(got!.instructions).toBe("Search broadly.");
      expect(got!.tools).toEqual([{ type: "inline", name: "web_search" }]);
      expect(got!.metadata).toEqual({ team: "research" });
      // createdAt/updatedAt should be populated by the store.
      expect(typeof got!.createdAt).toBe("string");
      expect(typeof got!.updatedAt).toBe("string");
    });

    it("listSkills returns name+description summaries, sorted by name", async () => {
      await storeA.putSkill(makeSkill({ name: "zeta", description: "z-desc" }));
      await storeA.putSkill(makeSkill({ name: "alpha", description: "a-desc" }));
      await storeA.putSkill(makeSkill({ name: "mu", description: "m-desc" }));

      const list = await storeA.listSkills();
      expect(list).toEqual([
        { name: "alpha", description: "a-desc" },
        { name: "mu", description: "m-desc" },
        { name: "zeta", description: "z-desc" },
      ]);
    });

    it("putSkill updates an existing skill (upsert)", async () => {
      await storeA.putSkill(makeSkill({ name: "x", description: "v1" }));
      await storeA.putSkill(makeSkill({ name: "x", description: "v2" }));
      const got = await storeA.getSkill("x");
      expect(got!.description).toBe("v2");
      const list = await storeA.listSkills();
      expect(list).toHaveLength(1);
    });

    it("deleteSkill removes the skill", async () => {
      await storeA.putSkill(makeSkill({ name: "doomed" }));
      expect(await storeA.getSkill("doomed")).not.toBeNull();

      await storeA.deleteSkill("doomed");
      expect(await storeA.getSkill("doomed")).toBeNull();
      expect(await storeA.listSkills()).toEqual([]);
    });

    it("deleteSkill on unknown name is a silent no-op", async () => {
      await expect(storeA.deleteSkill("ghost")).resolves.toBeUndefined();
    });

    it("isolates skills per user", async () => {
      await storeA.putSkill(makeSkill({ name: "owned-by-a", description: "a only" }));
      await storeB.putSkill(makeSkill({ name: "owned-by-b", description: "b only" }));

      // A can see its own skill but not B's.
      expect(await storeA.getSkill("owned-by-a")).not.toBeNull();
      expect(await storeA.getSkill("owned-by-b")).toBeNull();
      const listA = await storeA.listSkills();
      expect(listA.map((s) => s.name)).toEqual(["owned-by-a"]);

      // B can see its own skill but not A's.
      expect(await storeB.getSkill("owned-by-b")).not.toBeNull();
      expect(await storeB.getSkill("owned-by-a")).toBeNull();
      const listB = await storeB.listSkills();
      expect(listB.map((s) => s.name)).toEqual(["owned-by-b"]);
    });

    it("allows the same skill name across different users", async () => {
      await storeA.putSkill(makeSkill({ name: "researcher", description: "a's flavor" }));
      await storeB.putSkill(makeSkill({ name: "researcher", description: "b's flavor" }));

      expect((await storeA.getSkill("researcher"))!.description).toBe("a's flavor");
      expect((await storeB.getSkill("researcher"))!.description).toBe("b's flavor");
    });

    it("deletion is also scoped to the user", async () => {
      await storeA.putSkill(makeSkill({ name: "shared", description: "a" }));
      await storeB.putSkill(makeSkill({ name: "shared", description: "b" }));

      await storeA.deleteSkill("shared");

      expect(await storeA.getSkill("shared")).toBeNull();
      expect(await storeB.getSkill("shared")).not.toBeNull();
    });

    it("rejects structurally-invalid skills (delegates to defineSkill)", async () => {
      // Bad name: uppercase
      await expect(
        storeA.putSkill(makeSkill({ name: "BadName" })),
      ).rejects.toThrow(/lowercase-kebab-case/);

      // Empty description
      await expect(
        storeA.putSkill(makeSkill({ name: "valid", description: "" })),
      ).rejects.toThrow(/description/);

      // Empty instructions
      await expect(
        storeA.putSkill(makeSkill({ name: "valid", instructions: "" })),
      ).rejects.toThrow(/instructions/);

      // Malformed tools entry
      await expect(
        storeA.putSkill(
          makeSkill({
            name: "valid",
            // @ts-expect-error: testing runtime validation
            tools: [{ type: "inline" }],
          }),
        ),
      ).rejects.toThrow(/inline.*name/);
    });
  });
}

// ─── Backend wiring ────────────────────────────────────────────────────

runSkillStoreConformance("MemoryStore", async () => {
  const admin = new MemoryStore();
  return {
    storeA: admin.forUser("u1"),
    storeB: admin.forUser("u2"),
    cleanup: () => {},
  };
});

runSkillStoreConformance("JsonFileStore", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agntz-skillstore-"));
  const admin = new JsonFileStore(dir);
  return {
    storeA: admin.forUser("u1"),
    storeB: admin.forUser("u2"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
});
