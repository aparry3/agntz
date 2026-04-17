import type { MCPServerConfig } from "../types.js";

export interface ListToolsOptions {
  /** Abort the connection if listTools hasn't returned within this many ms. */
  timeoutMs?: number;
}

/**
 * One-shot connection to an MCP server that lists available tool names.
 * Opens a client, calls listTools, closes the client, and returns tool names.
 * Intended for validation-time use; for long-lived connections use MCPClientManager.
 */
export async function listToolsOnServer(
  config: MCPServerConfig,
  options: ListToolsOptions = {},
): Promise<string[]> {
  if (!config.url) {
    throw new Error("MCP server config must include a url");
  }

  const { Client } = await import(
    "@modelcontextprotocol/sdk/client/index.js"
  );
  const { StreamableHTTPClientTransport } = await import(
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );

  const client = new Client({ name: "agntz-validator", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  const timeoutMs = options.timeoutMs ?? 10_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
    const result = await Promise.race([client.listTools(), timeout]);
    return (result.tools ?? []).map((t: { name: string }) => t.name);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await client.close();
    } catch {
      // Ignore close errors
    }
  }
}
