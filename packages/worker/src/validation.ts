import {
  createRunner,
  listToolsOnServer,
  resolveMCPServer,
  type UnifiedStore,
} from "@agntz/core";
import type { ValidationContext } from "@agntz/manifest";
import { LOCAL_TOOL_NAMES } from "./tools/registry.js";

export interface BuildValidationContextOptions {
  /** When true, MCP connection failures are reported as errors (save-time). */
  strict?: boolean;
  /** Timeout for each MCP connection + listTools call. */
  mcpTimeoutMs?: number;
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

  return {
    strict: options.strict,
    localTools: [...LOCAL_TOOL_NAMES],
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
