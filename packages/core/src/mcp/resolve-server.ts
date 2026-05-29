import type { ConnectionStore, MCPConnectionConfig } from "../types.js";

export interface ResolvedMCPServer {
	url: string;
	headers?: Record<string, string>;
	source: "registered" | "url";
}

/**
 * Turn the `server:` value from an agent manifest into a concrete MCP config.
 * Registry-first: if `ref` matches a registered `kind=mcp` connection id for
 * the user, use that connection's config. Otherwise treat `ref` as a URL.
 *
 * `entryHeaders` are optional headers from the manifest entry itself
 * (`MCPToolEntry.headers`). They're merged onto the resolved config — entry
 * values win on key conflicts — so manifest-scoped overrides are honored
 * while still falling back to registered defaults.
 */
export async function resolveMCPServer(
	ref: string,
	store: ConnectionStore,
	entryHeaders?: Record<string, string>,
): Promise<ResolvedMCPServer> {
	const registered = await store.getConnection("mcp", ref);
	if (registered) {
		const cfg = registered.config as MCPConnectionConfig;
		const mergedHeaders = mergeHeaders(cfg.headers, entryHeaders);
		return { url: cfg.url, headers: mergedHeaders, source: "registered" };
	}
	return { url: ref, headers: entryHeaders, source: "url" };
}

function mergeHeaders(
	base?: Record<string, string>,
	override?: Record<string, string>,
): Record<string, string> | undefined {
	if (!base && !override) return undefined;
	return { ...(base ?? {}), ...(override ?? {}) };
}
