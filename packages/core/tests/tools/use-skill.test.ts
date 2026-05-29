import { describe, expect, it, vi } from "vitest";
import { createUseSkillTool } from "../../src/tools/use-skill.js";
import type {
	SkillDefinition,
	SkillStore,
	ToolContext,
	ToolReference,
} from "../../src/types.js";

/**
 * Minimal in-memory SkillStore for use-skill tests. Only `getSkill` is wired;
 * other methods throw if accidentally called.
 */
function makeSkillStore(skills: SkillDefinition[]): SkillStore {
	const byName = new Map<string, SkillDefinition>(
		skills.map((s) => [s.name, s]),
	);
	return {
		async getSkill(name) {
			return byName.get(name) ?? null;
		},
		async listSkills() {
			return Array.from(byName.values()).map((s) => ({
				name: s.name,
				description: s.description,
			}));
		},
		async putSkill() {
			throw new Error("not used in tests");
		},
		async deleteSkill() {
			throw new Error("not used in tests");
		},
	};
}

/**
 * Build a stub ToolContext with the fields the use_skill tool consumes. Any
 * field can be omitted via `overrides: { fieldName: undefined }` to test
 * missing-context paths.
 */
function makeCtx(
	overrides: {
		skillStore?: SkillStore | null;
		loadedSkills?: Set<string> | null;
		registerSkillTools?:
			| ((refs: ToolReference[]) => Promise<
					Array<{
						name: string;
						description: string;
						parameters: Record<string, unknown>;
					}>
			  >)
			| null;
	} = {},
): ToolContext {
	const ctx: ToolContext = {
		agentId: "test-agent",
		invocationId: "inv-1",
		invoke: async () => {
			throw new Error("invoke not used");
		},
	};
	if (overrides.skillStore !== null) {
		ctx.skillStore = overrides.skillStore ?? makeSkillStore([]);
	}
	if (overrides.loadedSkills !== null) {
		ctx.loadedSkills = overrides.loadedSkills ?? new Set<string>();
	}
	if (overrides.registerSkillTools !== null) {
		ctx.registerSkillTools = overrides.registerSkillTools ?? (async () => []);
	}
	return ctx;
}

describe("createUseSkillTool", () => {
	it("returns null when skill names array is empty", () => {
		expect(createUseSkillTool([])).toBeNull();
	});

	it("returns a ToolDefinition with name 'use_skill' for a non-empty array", () => {
		const tool = createUseSkillTool(["researcher"]);
		expect(tool).not.toBeNull();
		expect(tool?.name).toBe("use_skill");
		expect(typeof tool?.description).toBe("string");
		expect(typeof tool?.execute).toBe("function");
	});

	it("description lists each skill name", () => {
		const tool = createUseSkillTool([
			"researcher",
			"summarizer",
			"fact-checker",
		]);
		expect(tool?.description).toContain("researcher");
		expect(tool?.description).toContain("summarizer");
		expect(tool?.description).toContain("fact-checker");
	});

	it("input is a Zod object with a `skill` enum constrained to the allowlist", () => {
		const tool = createUseSkillTool(["a", "b"])!;
		// Valid values pass
		expect(() => tool.input.parse({ skill: "a" })).not.toThrow();
		expect(() => tool.input.parse({ skill: "b" })).not.toThrow();
		// Out-of-allowlist value fails
		expect(() => tool.input.parse({ skill: "c" })).toThrow();
		// Wrong shape fails
		expect(() => tool.input.parse({})).toThrow();
	});

	describe("execute", () => {
		const researcher: SkillDefinition = {
			name: "researcher",
			description: "Web research.",
			instructions: "Search broadly.",
			tools: [{ type: "inline", name: "web_search" }],
		};
		const summarizer: SkillDefinition = {
			name: "summarizer",
			description: "Summarize.",
			instructions: "Output a TL;DR.",
		};

		it("loads a known skill: returns instructions and calls registerSkillTools with the skill's tools", async () => {
			const register = vi
				.fn()
				.mockResolvedValue([
					{ name: "web_search", description: "Search.", parameters: {} },
				]);
			const loaded = new Set<string>();
			const tool = createUseSkillTool(["researcher"])!;
			const ctx = makeCtx({
				skillStore: makeSkillStore([researcher]),
				loadedSkills: loaded,
				registerSkillTools: register,
			});

			const out = (await tool.execute({ skill: "researcher" }, ctx)) as {
				name: string;
				description: string;
				instructions: string;
			};

			expect(out.name).toBe("researcher");
			expect(out.description).toBe("Web research.");
			expect(out.instructions).toBe("Search broadly.");

			expect(register).toHaveBeenCalledTimes(1);
			expect(register).toHaveBeenCalledWith([
				{ type: "inline", name: "web_search" },
			]);

			expect(loaded.has("researcher")).toBe(true);
		});

		it("does not call registerSkillTools when the skill has no tools", async () => {
			const register = vi.fn();
			const tool = createUseSkillTool(["summarizer"])!;
			const ctx = makeCtx({
				skillStore: makeSkillStore([summarizer]),
				loadedSkills: new Set<string>(),
				registerSkillTools: register,
			});

			const out = (await tool.execute({ skill: "summarizer" }, ctx)) as {
				name: string;
				instructions: string;
			};

			expect(out.name).toBe("summarizer");
			expect(out.instructions).toBe("Output a TL;DR.");
			expect(register).not.toHaveBeenCalled();
		});

		it("returns { alreadyLoaded: true, name } when the skill is in ctx.loadedSkills", async () => {
			const register = vi.fn();
			const tool = createUseSkillTool(["researcher"])!;
			const loaded = new Set<string>(["researcher"]);
			const ctx = makeCtx({
				skillStore: makeSkillStore([researcher]),
				loadedSkills: loaded,
				registerSkillTools: register,
			});

			const out = (await tool.execute({ skill: "researcher" }, ctx)) as {
				alreadyLoaded: boolean;
				name: string;
			};

			expect(out).toEqual({ alreadyLoaded: true, name: "researcher" });
			expect(register).not.toHaveBeenCalled();
		});

		it("returns an error result when the skill is unknown in the store", async () => {
			const register = vi.fn();
			const tool = createUseSkillTool(["researcher"])!;
			const ctx = makeCtx({
				skillStore: makeSkillStore([]), // empty store
				loadedSkills: new Set<string>(),
				registerSkillTools: register,
			});

			const out = (await tool.execute({ skill: "researcher" }, ctx)) as {
				ok: false;
				error: string;
			};

			expect(out.ok).toBe(false);
			expect(out.error).toMatch(/researcher/);
			expect(register).not.toHaveBeenCalled();
		});

		it("returns an error result when ctx.skillStore is missing", async () => {
			const tool = createUseSkillTool(["researcher"])!;
			const ctx = makeCtx({ skillStore: null });

			const out = (await tool.execute({ skill: "researcher" }, ctx)) as {
				ok: false;
				error: string;
			};

			expect(out.ok).toBe(false);
			expect(out.error).toMatch(/skillStore|registerSkillTools|loadedSkills/);
		});

		it("returns an error result when ctx.loadedSkills is missing", async () => {
			const tool = createUseSkillTool(["researcher"])!;
			const ctx = makeCtx({ loadedSkills: null });

			const out = (await tool.execute({ skill: "researcher" }, ctx)) as {
				ok: false;
				error: string;
			};

			expect(out.ok).toBe(false);
			expect(out.error).toMatch(/skillStore|registerSkillTools|loadedSkills/);
		});

		it("returns an error result when ctx.registerSkillTools is missing", async () => {
			const tool = createUseSkillTool(["researcher"])!;
			const ctx = makeCtx({ registerSkillTools: null });

			const out = (await tool.execute({ skill: "researcher" }, ctx)) as {
				ok: false;
				error: string;
			};

			expect(out.ok).toBe(false);
			expect(out.error).toMatch(/skillStore|registerSkillTools|loadedSkills/);
		});
	});
});
