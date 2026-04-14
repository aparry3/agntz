import type { AgentDefinition, AgentVersionSummary, UnifiedStore } from "@agent-runner/core";

export async function listVersions(store: UnifiedStore, agentId: string): Promise<AgentVersionSummary[]> {
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
