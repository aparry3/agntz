import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresStore } from "../src/postgres-store.js";
import type { SkillDefinition } from "@agntz/core";

/**
 * Integration tests for PostgresStore SkillStore. Runs against a real
 * Postgres instance when DATABASE_URL is set; skipped otherwise (CI should
 * provide a test DB). Mirrors the contract exercised by
 * packages/core/tests/stores/skill-store-conformance.test.ts.
 *
 * Uses a per-suite tablePrefix so concurrent runs don't collide.
 */
const url = process.env.DATABASE_URL;
const hasDb = !!url;

describe.skipIf(!hasDb)("PostgresStore SkillStore (integration)", () => {
  let admin: PostgresStore;
  const prefix = `art_skills_${Date.now()}_`;
  const userA = `user_skill_a_${Date.now()}`;
  const userB = `user_skill_b_${Date.now()}`;

  beforeAll(async () => {
    admin = new PostgresStore({ connection: url!, tablePrefix: prefix });
  });

  afterAll(async () => {
    try {
      await admin.pgPool.query(`DROP TABLE IF EXISTS ${prefix}skills CASCADE`);
    } catch {
      // ignore
    }
    await admin.close();
  });

  function makeSkill(overrides: Partial<SkillDefinition> & { name: string }): SkillDefinition {
    return {
      name: overrides.name,
      description: overrides.description ?? `desc for ${overrides.name}`,
      instructions: overrides.instructions ?? `instructions for ${overrides.name}`,
      tools: overrides.tools,
      metadata: overrides.metadata,
      createdAt: overrides.createdAt,
      updatedAt: overrides.updatedAt,
    };
  }

  it("getSkill returns null for an unknown name", async () => {
    const store = admin.forUser(userA);
    expect(await store.getSkill("pg-nope")).toBeNull();
  });

  it("round-trips a skill via putSkill and getSkill", async () => {
    const store = admin.forUser(userA);
    await store.putSkill(
      makeSkill({
        name: "pg-researcher",
        description: "Web research.",
        instructions: "Search broadly.",
        tools: [{ type: "inline", name: "web_search" }],
        metadata: { team: "research" },
      }),
    );
    const got = await store.getSkill("pg-researcher");
    expect(got).not.toBeNull();
    expect(got!.name).toBe("pg-researcher");
    expect(got!.description).toBe("Web research.");
    expect(got!.instructions).toBe("Search broadly.");
    expect(got!.tools).toEqual([{ type: "inline", name: "web_search" }]);
    expect(got!.metadata).toEqual({ team: "research" });
    expect(typeof got!.createdAt).toBe("string");
    expect(typeof got!.updatedAt).toBe("string");
  });

  it("listSkills returns name+description summaries sorted by name", async () => {
    const userId = `user_list_${Date.now()}`;
    const store = admin.forUser(userId);
    await store.putSkill(makeSkill({ name: "zeta", description: "z-desc" }));
    await store.putSkill(makeSkill({ name: "alpha", description: "a-desc" }));
    await store.putSkill(makeSkill({ name: "mu", description: "m-desc" }));

    expect(await store.listSkills()).toEqual([
      { name: "alpha", description: "a-desc" },
      { name: "mu", description: "m-desc" },
      { name: "zeta", description: "z-desc" },
    ]);
  });

  it("putSkill updates an existing skill (upsert)", async () => {
    const userId = `user_upsert_${Date.now()}`;
    const store = admin.forUser(userId);
    await store.putSkill(makeSkill({ name: "x", description: "v1" }));
    await store.putSkill(makeSkill({ name: "x", description: "v2" }));
    expect((await store.getSkill("x"))!.description).toBe("v2");
    expect(await store.listSkills()).toHaveLength(1);
  });

  it("deleteSkill removes the skill", async () => {
    const userId = `user_delete_${Date.now()}`;
    const store = admin.forUser(userId);
    await store.putSkill(makeSkill({ name: "doomed" }));
    expect(await store.getSkill("doomed")).not.toBeNull();
    await store.deleteSkill("doomed");
    expect(await store.getSkill("doomed")).toBeNull();
  });

  it("deleteSkill on unknown name is a silent no-op", async () => {
    const store = admin.forUser(userA);
    await expect(store.deleteSkill("ghost")).resolves.toBeUndefined();
  });

  it("isolates skills per user (same name allowed for different users)", async () => {
    const storeA = admin.forUser(userA);
    const storeB = admin.forUser(userB);
    await storeA.putSkill(makeSkill({ name: "shared-name", description: "a-flavor" }));
    await storeB.putSkill(makeSkill({ name: "shared-name", description: "b-flavor" }));

    expect((await storeA.getSkill("shared-name"))!.description).toBe("a-flavor");
    expect((await storeB.getSkill("shared-name"))!.description).toBe("b-flavor");

    // Deletion in A doesn't affect B.
    await storeA.deleteSkill("shared-name");
    expect(await storeA.getSkill("shared-name")).toBeNull();
    expect(await storeB.getSkill("shared-name")).not.toBeNull();
  });

  it("rejects structurally-invalid skills (delegates to defineSkill)", async () => {
    const store = admin.forUser(userA);
    await expect(
      store.putSkill(makeSkill({ name: "BadName" })),
    ).rejects.toThrow(/lowercase-kebab-case/);

    await expect(
      store.putSkill(makeSkill({ name: "valid", description: "" })),
    ).rejects.toThrow(/description/);

    await expect(
      store.putSkill(makeSkill({ name: "valid", instructions: "" })),
    ).rejects.toThrow(/instructions/);

    await expect(
      store.putSkill(
        makeSkill({
          name: "valid",
          // @ts-expect-error: testing runtime validation
          tools: [{ type: "inline" }],
        }),
      ),
    ).rejects.toThrow(/inline.*name/);
  });
});
