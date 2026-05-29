import { z } from "zod";
import type {
	SkillStore,
	ToolContext,
	ToolDefinition,
	ToolReference,
} from "../types.js";

/**
 * Build the `use_skill` tool. Returns null if `skillNames` is empty. The
 * `skill` arg is constrained to the agent's allowlist via the Zod enum.
 */
export function createUseSkillTool(
	skillNames: string[],
): ToolDefinition | null {
	if (skillNames.length === 0) return null;

	const names = skillNames as [string, ...string[]];

	const description = [
		"Load a named skill into the current run. Returns the skill's instructions and registers its tools for the rest of the run.",
		"If the skill was already loaded earlier in this run, returns { alreadyLoaded: true }.",
		"Available skills:",
		...skillNames.map((n) => `  - ${n}`),
	].join("\n");

	return {
		name: "use_skill",
		description,
		input: z.object({
			skill: z
				.enum(names)
				.describe("Which skill to load (must be from this agent's allowlist)."),
		}),
		async execute(input, ctx) {
			const { skill } = input as { skill: string };

			const c = ctx as ToolContext;
			const loaded = c.loadedSkills as Set<string> | undefined;
			const store = c.skillStore as SkillStore | undefined;
			const register = c.registerSkillTools as
				| ((refs: ToolReference[]) => Promise<
						Array<{
							name: string;
							description: string;
							parameters: Record<string, unknown>;
						}>
				  >)
				| undefined;

			if (!loaded || !store || !register) {
				return {
					ok: false,
					error:
						"use_skill requires the runner to thread skillStore, loadedSkills, and registerSkillTools through ToolContext.",
				};
			}

			if (loaded.has(skill)) {
				return { alreadyLoaded: true, name: skill };
			}

			const def = await store.getSkill(skill);
			if (!def) {
				return { ok: false, error: `skill "${skill}" not found` };
			}

			loaded.add(skill);

			if (def.tools && def.tools.length > 0) {
				await register(def.tools);
			}

			return {
				name: def.name,
				description: def.description,
				instructions: def.instructions,
			};
		},
	};
}
