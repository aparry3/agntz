import {
	type OutboundUrlPolicyOptions,
	type UnifiedStore,
	createRunner,
	listToolsOnServer,
	resolveMCPServer,
} from "@agntz/core";
import type { ValidationContext } from "@agntz/manifest";
import { LOCAL_TOOL_NAMES } from "./tools/registry.js";

export interface BuildValidationContextOptions {
	/** When true, MCP connection failures are reported as errors (save-time). */
	strict?: boolean;
	/** Override outbound URL policy for validation network calls. */
	outboundUrlPolicy?: OutboundUrlPolicyOptions;
	/** Timeout for each MCP connection + listTools call. */
	mcpTimeoutMs?: number;
	/** Agent ids that will be created by the same batch operation. */
	extraAgentIds?: Iterable<string>;
}

/**
 * Build a ValidationContext for a given user. Looks up agents and MCP
 * connections in the caller's user-scoped store and pulls the local tool
 * registry from the worker's own tools/registry.
 *
 * Callers pass their user-scoped UnifiedStore; the function constructs a
 * lightweight Runner internally just to reuse its agent/connection
 * accessors — no tools or defaults are required for validation.
 */
export function buildValidationContext(
	store: UnifiedStore,
	options: BuildValidationContextOptions = {},
): ValidationContext {
	const runner = createRunner({ store });
	const toolCache = new Map<string, Promise<string[]>>();
	const extraAgentIds = new Set(options.extraAgentIds ?? []);

	return {
		strict: options.strict,
		outboundUrlPolicy: options.outboundUrlPolicy,
		localTools: [...LOCAL_TOOL_NAMES],
		resolveAgent: async (id: string) => {
			if (extraAgentIds.has(id)) return true;
			const agent = await runner.agents.getAgent(id);
			return agent != null;
		},
		resolveSkill: async (name: string) => {
			const skill = await store.getSkill(name);
			return skill != null;
		},
		resolveSecret: async (name: string) => {
			const meta = await store.getSecretMetadata(name);
			return meta != null;
		},
		resolveTools: async (ref: string) => {
			const connections = runner.connections;
			const resolved = connections
				? await resolveMCPServer(ref, connections)
				: { url: ref, source: "url" as const };
			const cached = toolCache.get(resolved.url);
			if (cached) return cached;
			const promise = listToolsOnServer(
				{ url: resolved.url, headers: resolved.headers },
				{
					timeoutMs: options.mcpTimeoutMs ?? 10_000,
					outboundUrlPolicy: options.outboundUrlPolicy,
				},
			);
			toolCache.set(resolved.url, promise);
			return promise;
		},
	};
}
