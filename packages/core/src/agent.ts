import type { AgentDefinition } from "./types.js";

/**
 * Define an agent. Validates the definition and adds timestamps.
 * This is a convenience function — you can also create AgentDefinition objects directly.
 */
export function defineAgent(
	definition: Omit<AgentDefinition, "createdAt" | "updatedAt"> & {
		createdAt?: string;
		updatedAt?: string;
	},
): AgentDefinition {
	if (!definition.id) {
		throw new Error("Agent definition requires an 'id'");
	}
	if (!definition.name) {
		throw new Error("Agent definition requires a 'name'");
	}
	if (!definition.systemPrompt) {
		throw new Error("Agent definition requires a 'systemPrompt'");
	}
	if (!definition.model) {
		throw new Error("Agent definition requires a 'model'");
	}
	if (!definition.model.provider || !definition.model.name) {
		throw new Error("Agent model requires both 'provider' and 'name'");
	}

	const now = new Date().toISOString();

	return {
		...definition,
		createdAt: definition.createdAt ?? now,
		updatedAt: definition.updatedAt ?? now,
	};
}
