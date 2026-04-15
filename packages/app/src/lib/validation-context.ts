import { listToolsOnServer, type Runner } from "@agntz/core";
import { LOCAL_TOOL_NAMES } from "@agntz/worker";
import type { ValidationContext } from "@agntz/manifest";

export interface BuildValidationContextOptions {
  /** When true, MCP connection failures are reported as errors (save-time). */
  strict?: boolean;
  /** Timeout for each MCP connection + listTools call. */
  mcpTimeoutMs?: number;
}

/**
 * Build a ValidationContext for the manifest validator.
 * resolveTools opens a one-shot MCP connection per unique server URL
 * (memoized within this context instance so a manifest that references the
 * same server multiple times only pays the connect cost once).
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
    resolveTools: (server: string) => {
      const cached = toolCache.get(server);
      if (cached) return cached;
      const promise = listToolsOnServer(
        { url: server },
        { timeoutMs: options.mcpTimeoutMs ?? 10_000 },
      );
      toolCache.set(server, promise);
      return promise;
    },
  };
}
