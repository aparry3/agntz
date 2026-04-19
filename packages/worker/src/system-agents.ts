import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentManifest } from "@agntz/manifest";
import { parseManifest } from "@agntz/manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * System agents ship in the repo as YAML and power application-level features
 * (agent-builder drives the Next.js "Create from description" flow). They're
 * not stored in the database and not editable per-user — to change the
 * behavior you edit the YAML and redeploy.
 *
 * Invoked via `agentId: "system:<name>"`.
 */
const SYSTEM_AGENT_PATHS: Record<string, string> = {
  "agent-builder": resolve(__dirname, "defaults/agents/agent-builder/manifest.yaml"),
};

const SYSTEM_PREFIX = "system:";

export function isSystemAgentId(agentId: string): boolean {
  return agentId.startsWith(SYSTEM_PREFIX);
}

export interface SystemAgentInfo {
  /** Full id with prefix — e.g. "system:agent-builder". */
  id: string;
  /** Short name — e.g. "agent-builder". */
  name: string;
  /** From the parsed manifest (falls back to name if missing). */
  displayName: string;
  description?: string;
  yaml: string;
  manifest: AgentManifest;
  /** Absolute path to the YAML on disk — handy for debugging. */
  sourcePath: string;
}

const manifestCache = new Map<string, SystemAgentInfo>();

async function load(name: string): Promise<SystemAgentInfo | null> {
  const cached = manifestCache.get(name);
  if (cached) return cached;

  const path = SYSTEM_AGENT_PATHS[name];
  if (!path) return null;

  const yaml = await readFile(path, "utf-8");
  const manifest = parseManifest(yaml);
  const info: SystemAgentInfo = {
    id: `${SYSTEM_PREFIX}${name}`,
    name,
    displayName: manifest.name ?? name,
    description: manifest.description,
    yaml,
    manifest,
    sourcePath: path,
  };
  manifestCache.set(name, info);
  return info;
}

export async function loadSystemAgent(agentId: string): Promise<AgentManifest> {
  if (!isSystemAgentId(agentId)) {
    throw new Error(`Not a system agent id: ${agentId}`);
  }
  const name = agentId.slice(SYSTEM_PREFIX.length);
  const info = await load(name);
  if (!info) {
    throw Object.assign(new Error(`Unknown system agent: ${agentId}`), { code: "NOT_FOUND" });
  }
  return info.manifest;
}

export async function listSystemAgents(): Promise<SystemAgentInfo[]> {
  const results: SystemAgentInfo[] = [];
  for (const name of Object.keys(SYSTEM_AGENT_PATHS)) {
    const info = await load(name);
    if (info) results.push(info);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSystemAgent(agentId: string): Promise<SystemAgentInfo | null> {
  const name = agentId.startsWith(SYSTEM_PREFIX)
    ? agentId.slice(SYSTEM_PREFIX.length)
    : agentId;
  return load(name);
}
