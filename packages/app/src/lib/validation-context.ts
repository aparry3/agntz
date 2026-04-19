import { listToolsOnServer, resolveMCPServer, type Runner } from "@agntz/core";
import { LOCAL_TOOL_NAMES } from "./local-tools";
import type { ValidationContext } from "@agntz/manifest";

export interface BuildValidationContextOptions {
  /** When true, MCP connection failures are reported as errors (save-time). */
  strict?: boolean;
  /** Timeout for each MCP connection + listTools call. */
  mcpTimeoutMs?: number;
}

/**
 * Build a ValidationContext for the manifest validator.
 *
 * `resolveTools` accepts either a registered MCP connection id (e.g. `gymtext`)
 * or a raw URL. Registered connections win; unknown refs fall back to being
 * treated as URLs. Results are memoized per resolved URL so a manifest that
 * references the same server by different refs only pays one connect cost.
 */
export function buildValidationContext(
  runner: Runner,
  options: BuildValidationContextOptions = {},
): ValidationContext {
  const toolCache = new Map<string, Promise<string[]>>();

  return {
    strict: options.strict,
    localTools: LOCAL_TOOL_NAMES,
    resolveAgent: async (id: string) => {
      const agent = await runner.agents.getAgent(id);
      return agent != null;
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
        { timeoutMs: options.mcpTimeoutMs ?? 10_000 },
      );
      toolCache.set(resolved.url, promise);
      return promise;
    },
  };
}
