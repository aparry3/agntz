// Walk a raw (parsed-YAML) agent manifest and collect every distinct MCP
// tool entry. Used by the inline MCP picker to surface quick-picks for
// reusing a URL already wired up elsewhere in the same manifest tree.
//
// Distinct keys are `server` strings (whether a registered id or a raw URL).
// Headers from the first occurrence win — later duplicates are ignored so
// the quick-pick preserves the original configuration.

export interface ScannedMcpEntry {
	server: string;
	headers?: Record<string, string>;
}

export function scanMcpEntries(root: unknown): ScannedMcpEntry[] {
	const seen = new Map<string, ScannedMcpEntry>();
	walkAgent(root, seen);
	return Array.from(seen.values());
}

function walkAgent(agent: unknown, seen: Map<string, ScannedMcpEntry>): void {
	if (!isRecord(agent)) return;
	const kind = agent.kind;

	if (kind === "llm" && Array.isArray(agent.tools)) {
		for (const entry of agent.tools) collectMcp(entry, seen);
	}

	if (Array.isArray(agent.steps)) {
		for (const step of agent.steps) walkStep(step, seen);
	}
	if (Array.isArray(agent.branches)) {
		for (const branch of agent.branches) walkStep(branch, seen);
	}
	if (Array.isArray(agent.spawnable)) {
		for (const sp of agent.spawnable) walkSpawnable(sp, seen);
	}
}

function walkStep(step: unknown, seen: Map<string, ScannedMcpEntry>): void {
	if (!isRecord(step)) return;
	if (isRecord(step.agent)) walkAgent(step.agent, seen);
	// step.ref is a string agent id — we can't resolve it without the catalog,
	// and the catalog only exposes id/name, not the full manifest. Skip.
}

function walkSpawnable(
	entry: unknown,
	seen: Map<string, ScannedMcpEntry>,
): void {
	if (!isRecord(entry)) return;
	if (isRecord(entry.definition)) walkAgent(entry.definition, seen);
}

function collectMcp(entry: unknown, seen: Map<string, ScannedMcpEntry>): void {
	if (!isRecord(entry)) return;
	if (entry.kind !== "mcp") return;
	const server = entry.server;
	if (typeof server !== "string" || !server) return;
	if (seen.has(server)) return;
	const headers = isHeadersRecord(entry.headers) ? entry.headers : undefined;
	seen.set(server, { server, ...(headers ? { headers } : {}) });
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return v != null && typeof v === "object" && !Array.isArray(v);
}

function isHeadersRecord(v: unknown): v is Record<string, string> {
	if (!isRecord(v)) return false;
	return Object.values(v).every((x) => typeof x === "string");
}
