import type {
	AgentDefinition,
	AgentVersionSummary,
	UnifiedStore,
} from "@agntz/core";

export async function listVersions(
	store: UnifiedStore,
	agentId: string,
): Promise<AgentVersionSummary[]> {
	return store.listAgentVersions(agentId);
}

export async function getVersion(
	store: UnifiedStore,
	agentId: string,
	createdAt: string,
): Promise<AgentDefinition | null> {
	return store.getAgentVersion(agentId, createdAt);
}

export async function activateVersion(
	store: UnifiedStore,
	agentId: string,
	createdAt: string,
): Promise<void> {
	await store.activateAgentVersion(agentId, createdAt);
}

export async function setAlias(
	store: UnifiedStore,
	agentId: string,
	createdAt: string,
	alias: string,
): Promise<void> {
	await store.setAgentVersionAlias(agentId, createdAt, alias);
}

export async function removeAlias(
	store: UnifiedStore,
	agentId: string,
	alias: string,
): Promise<void> {
	await store.removeAgentVersionAlias(agentId, alias);
}
