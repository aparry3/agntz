"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: string[];
  configured: boolean;
}

export interface ToolCatalogEntry {
  name: string;
  description: string;
  source: "inline" | `mcp:${string}`;
}

export interface AgentCatalogEntry {
  id: string;
  name: string;
  description?: string;
}

export interface McpServerCatalogEntry {
  id: string;
  displayName: string;
  description: string | null;
  url: string | null;
}

export interface SecretCatalogEntry {
  name: string;
  lastFour: string;
  description?: string;
}

export interface Catalog {
  providers: ProviderCatalogEntry[];
  tools: ToolCatalogEntry[];
  agents: AgentCatalogEntry[];
  mcpServers: McpServerCatalogEntry[];
  secrets: SecretCatalogEntry[];
  loading: boolean;
  mcpToolsByServer: Record<string, string[] | undefined>;
  loadMcpTools: (serverId: string) => Promise<string[]>;
}

interface ToolInfoFromApi {
  name: string;
  description?: string;
  source: "inline" | `mcp:${string}`;
}

interface AgentFromApi {
  id: string;
  name?: string;
  description?: string;
}

interface SecretFromApi {
  name: string;
  lastFour?: string;
  last_four?: string;
  description?: string;
}

export function useCatalog(): Catalog {
  const [providers, setProviders] = useState<ProviderCatalogEntry[]>([]);
  const [tools, setTools] = useState<ToolCatalogEntry[]>([]);
  const [agents, setAgents] = useState<AgentCatalogEntry[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerCatalogEntry[]>([]);
  const [secrets, setSecrets] = useState<SecretCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpToolsByServer, setMcpToolsByServer] = useState<Record<string, string[] | undefined>>({});
  const inflightMcpTools = useRef<Record<string, Promise<string[]> | undefined>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      fetch("/api/providers").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/tools").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/agents").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/mcp-servers").then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch("/api/secrets").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([providersData, toolsData, agentsData, serversData, secretsData]) => {
      if (cancelled) return;

      setProviders(Array.isArray(providersData) ? providersData : []);

      const toolsArr: ToolInfoFromApi[] = Array.isArray(toolsData) ? toolsData : [];
      setTools(
        toolsArr.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          source: t.source,
        })),
      );

      const agentsArr: AgentFromApi[] = Array.isArray(agentsData) ? agentsData : [];
      setAgents(
        agentsArr.map((a) => ({
          id: a.id,
          name: a.name ?? a.id,
          description: a.description,
        })),
      );

      setMcpServers(Array.isArray(serversData) ? serversData : []);

      const secretsArr: SecretFromApi[] = Array.isArray(secretsData) ? secretsData : [];
      setSecrets(
        secretsArr.map((s) => ({
          name: s.name,
          lastFour: s.lastFour ?? s.last_four ?? "",
          description: s.description,
        })),
      );

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const loadMcpTools = useCallback(async (serverId: string): Promise<string[]> => {
    const cached = mcpToolsByServer[serverId];
    if (cached) return cached;

    const inflight = inflightMcpTools.current[serverId];
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const res = await fetch(`/api/mcp-servers/${encodeURIComponent(serverId)}/tools`);
        const data = await res.json();
        const list: string[] = Array.isArray(data?.tools) ? data.tools : [];
        setMcpToolsByServer((current) => ({ ...current, [serverId]: list }));
        return list;
      } catch {
        setMcpToolsByServer((current) => ({ ...current, [serverId]: [] }));
        return [];
      } finally {
        inflightMcpTools.current[serverId] = undefined;
      }
    })();

    inflightMcpTools.current[serverId] = promise;
    return promise;
  }, [mcpToolsByServer]);

  return {
    providers,
    tools,
    agents,
    mcpServers,
    secrets,
    loading,
    mcpToolsByServer,
    loadMcpTools,
  };
}
