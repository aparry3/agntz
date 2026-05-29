import type { SkillDefinition } from "@agntz/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/sqlite-store.js";

/**
 * SqliteStore SkillStore conformance. Mirrors the contract exercised by
 * packages/core/tests/stores/skill-store-conformance.test.ts so any backend
 * divergence (composite PK, JSON serialization, user scoping) surfaces here.
 */
describe("SqliteStore SkillStore", () => {
	let admin: SqliteStore;
	let storeA: ReturnType<SqliteStore["forUser"]>;
	let storeB: ReturnType<SqliteStore["forUser"]>;

	beforeEach(() => {
		admin = new SqliteStore(":memory:");
		storeA = admin.forUser("u1");
		storeB = admin.forUser("u2");
	});

	afterEach(() => {
		admin.close();
	});

	function makeSkill(
		overrides: Partial<SkillDefinition> & { name: string },
	): SkillDefinition {
		return {
			name: overrides.name,
			description: overrides.description ?? `desc for ${overrides.name}`,
			instructions:
				overrides.instructions ?? `instructions for ${overrides.name}`,
			tools: overrides.tools,
			metadata: overrides.metadata,
			createdAt: overrides.createdAt,
			updatedAt: overrides.updatedAt,
		};
	}

	it("getSkill returns null for an unknown name", async () => {
		expect(await storeA.getSkill("nope")).toBeNull();
	});

	it("listSkills returns [] when no skills exist", async () => {
		expect(await storeA.listSkills()).toEqual([]);
	});

	it("round-trips a skill via putSkill and getSkill (tools + metadata)", async () => {
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
		expect(got?.name).toBe("researcher");
		expect(got?.description).toBe("Web research.");
		expect(got?.instructions).toBe("Search broadly.");
		expect(got?.tools).toEqual([{ type: "inline", name: "web_search" }]);
		expect(got?.metadata).toEqual({ team: "research" });
		expect(typeof got?.createdAt).toBe("string");
		expect(typeof got?.updatedAt).toBe("string");
	});

	it("listSkills returns name+description summaries sorted by name", async () => {
		await storeA.putSkill(makeSkill({ name: "zeta", description: "z-desc" }));
		await storeA.putSkill(makeSkill({ name: "alpha", description: "a-desc" }));
		await storeA.putSkill(makeSkill({ name: "mu", description: "m-desc" }));

		expect(await storeA.listSkills()).toEqual([
			{ name: "alpha", description: "a-desc" },
			{ name: "mu", description: "m-desc" },
			{ name: "zeta", description: "z-desc" },
		]);
	});

	it("putSkill updates an existing skill (upsert)", async () => {
		await storeA.putSkill(makeSkill({ name: "x", description: "v1" }));
		await storeA.putSkill(makeSkill({ name: "x", description: "v2" }));
		expect((await storeA.getSkill("x"))?.description).toBe("v2");
		expect(await storeA.listSkills()).toHaveLength(1);
	});

	it("deleteSkill removes the skill", async () => {
		await storeA.putSkill(makeSkill({ name: "doomed" }));
		expect(await storeA.getSkill("doomed")).not.toBeNull();
		await storeA.deleteSkill("doomed");
		expect(await storeA.getSkill("doomed")).toBeNull();
	});

	it("deleteSkill on unknown name is a silent no-op", async () => {
		await expect(storeA.deleteSkill("ghost")).resolves.toBeUndefined();
	});

	it("isolates skills per user (same name allowed for different users)", async () => {
		await storeA.putSkill(
			makeSkill({ name: "researcher", description: "a's flavor" }),
		);
		await storeB.putSkill(
			makeSkill({ name: "researcher", description: "b's flavor" }),
		);

		expect((await storeA.getSkill("researcher"))?.description).toBe(
			"a's flavor",
		);
		expect((await storeB.getSkill("researcher"))?.description).toBe(
			"b's flavor",
		);

		// Skills owned by user A don't leak to user B.
		await storeA.putSkill(makeSkill({ name: "only-a" }));
		expect(await storeB.getSkill("only-a")).toBeNull();
		expect((await storeB.listSkills()).map((s) => s.name)).toEqual([
			"researcher",
		]);
	});

	it("deletion is scoped to the user", async () => {
		await storeA.putSkill(makeSkill({ name: "shared" }));
		await storeB.putSkill(makeSkill({ name: "shared" }));

		await storeA.deleteSkill("shared");

		expect(await storeA.getSkill("shared")).toBeNull();
		expect(await storeB.getSkill("shared")).not.toBeNull();
	});

	it("rejects structurally-invalid skills (delegates to defineSkill)", async () => {
		await expect(
			storeA.putSkill(makeSkill({ name: "BadName" })),
		).rejects.toThrow(/lowercase-kebab-case/);

		await expect(
			storeA.putSkill(makeSkill({ name: "valid", description: "" })),
		).rejects.toThrow(/description/);

		await expect(
			storeA.putSkill(makeSkill({ name: "valid", instructions: "" })),
		).rejects.toThrow(/instructions/);

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
