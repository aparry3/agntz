import {
  OutboundUrlPolicyError,
  listToolsOnServer,
  validateOutboundUrl,
  type ConnectionKind,
} from "@agntz/core";

export const KNOWN_CONNECTION_KINDS: ConnectionKind[] = ["mcp"];
export const CONNECTION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function validateConnectionInput(params: {
  kind: unknown;
  id?: unknown;
  displayName: unknown;
  config: unknown;
  requireId?: boolean;
}): string | null {
  const { kind, id, displayName, config, requireId = true } = params;

  if (typeof kind !== "string" || !KNOWN_CONNECTION_KINDS.includes(kind as ConnectionKind)) {
    return `Missing or invalid field: kind (expected one of ${KNOWN_CONNECTION_KINDS.join(", ")})`;
  }
  if (requireId) {
    if (typeof id !== "string" || !CONNECTION_ID_PATTERN.test(id)) {
      return "Missing or invalid field: id (must match /^[a-z][a-z0-9_-]{0,63}$/)";
    }
  }
  if (typeof displayName !== "string" || displayName.trim().length === 0) {
    return "Missing required field: displayName";
  }
  if (!config || typeof config !== "object") {
    return "Missing required field: config";
  }

  if (kind === "mcp") {
    const cfg = config as Record<string, unknown>;
    if (typeof cfg.url !== "string") {
      return "MCP config requires a 'url' string";
    }
    try {
      validateOutboundUrl(cfg.url);
    } catch (err) {
      if (err instanceof OutboundUrlPolicyError) {
        return err.code === "invalid_url"
          ? "MCP config 'url' is not a valid URL"
          : `MCP config 'url' is not allowed: ${err.message}`;
      }
      return "MCP config 'url' is not a valid URL";
    }
    if (cfg.headers !== undefined) {
      if (!cfg.headers || typeof cfg.headers !== "object" || Array.isArray(cfg.headers)) {
        return "MCP config 'headers' must be an object of string values";
      }
      for (const v of Object.values(cfg.headers as Record<string, unknown>)) {
        if (typeof v !== "string") {
          return "MCP config 'headers' values must all be strings";
        }
      }
    }
  }

  return null;
}

export async function pingConnection(
  kind: ConnectionKind,
  config: Record<string, unknown>,
): Promise<string | null> {
  if (kind !== "mcp") return null;
  try {
    await listToolsOnServer(
      { url: String(config.url), headers: config.headers as Record<string, string> | undefined },
      { timeoutMs: 5_000 },
    );
    return null;
  } catch (err) {
    return `Could not connect to MCP server: ${(err as Error).message}`;
  }
}

// Hide sensitive header values from list/get responses.
export function maskConnectionConfig(kind: ConnectionKind, config: unknown): unknown {
  if (kind !== "mcp") return config;
  const cfg = config as { url?: string; headers?: Record<string, string> };
  if (!cfg.headers) return cfg;
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg.headers)) {
    masked[k] = v.length <= 8 ? "****" : v.slice(0, 4) + "..." + v.slice(-4);
  }
  return { ...cfg, headers: masked };
}
