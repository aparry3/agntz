"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: string[];
  configured: boolean;
}

export interface ProviderModelEntry {
  id: string;
  displayName?: string;
  contextLength?: number;
  pricing?: { prompt?: number; completion?: number };
  tags?: string[];
}

export interface ProviderModelsResult {
  models: ProviderModelEntry[];
  /** "live" = fetched from the provider; "fallback" = curated static list. */
  source: "live" | "fallback";
  /** True when the provider isn't configured and live fetch was skipped. */
  notConfigured?: boolean;
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
  /** Tool lists keyed by either registered server id or raw URL. */
  mcpToolsByServer: Record<string, string[] | undefined>;
  loadMcpTools: (serverId: string) => Promise<string[]>;
  /**
   * Fetch tools from an arbitrary MCP URL (POST /api/mcp-tools). Used by the
   * inline picker before the URL has been persisted to a manifest. Cached
   * under the URL itself in `mcpToolsByServer`.
   */
  loadMcpToolsForUrl: (url: string, headers?: Record<string, string>) => Promise<string[]>;
  /** Provider model catalogs, keyed by provider id. */
  modelsByProvider: Record<string, ProviderModelsResult | undefined>;
  /** Lazily fetch and cache the live model catalog for a provider. */
  loadProviderModels: (providerId: string) => Promise<ProviderModelsResult>;
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
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ProviderModelsResult | undefined>>({});
  const inflightModels = useRef<Record<string, Promise<ProviderModelsResult> | undefined>>({});

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

  const loadMcpToolsForUrl = useCallback(
    async (url: string, headers?: Record<string, string>): Promise<string[]> => {
      // Cache key is the URL itself — headers affect auth, not the tool list
      // shape. If the URL is already in the cache (e.g., set by a previous
      // call for the same manifest), reuse it.
      const cached = mcpToolsByServer[url];
      if (cached) return cached;

      const inflight = inflightMcpTools.current[url];
      if (inflight) return inflight;

      const promise = (async () => {
        try {
          const res = await fetch("/api/mcp-tools", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url, headers }),
          });
          const data = await res.json();
          const list: string[] = Array.isArray(data?.tools) ? data.tools : [];
          setMcpToolsByServer((current) => ({ ...current, [url]: list }));
          return list;
        } catch {
          setMcpToolsByServer((current) => ({ ...current, [url]: [] }));
          return [];
        } finally {
          inflightMcpTools.current[url] = undefined;
        }
      })();

      inflightMcpTools.current[url] = promise;
      return promise;
    },
    [mcpToolsByServer],
  );

  const loadProviderModels = useCallback(async (providerId: string): Promise<ProviderModelsResult> => {
    const cached = modelsByProvider[providerId];
    if (cached) return cached;

    const inflight = inflightModels.current[providerId];
    if (inflight) return inflight;

    const promise = (async (): Promise<ProviderModelsResult> => {
      try {
        const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/models`);
        if (res.status === 409) {
          const result: ProviderModelsResult = { models: [], source: "fallback", notConfigured: true };
          setModelsByProvider((current) => ({ ...current, [providerId]: result }));
          return result;
        }
        if (!res.ok) {
          const result: ProviderModelsResult = { models: [], source: "fallback" };
          setModelsByProvider((current) => ({ ...current, [providerId]: result }));
          return result;
        }
        const data = (await res.json()) as ProviderModelsResult;
        const result: ProviderModelsResult = {
          models: Array.isArray(data.models) ? data.models : [],
          source: data.source ?? "fallback",
        };
        setModelsByProvider((current) => ({ ...current, [providerId]: result }));
        return result;
      } catch {
        const result: ProviderModelsResult = { models: [], source: "fallback" };
        setModelsByProvider((current) => ({ ...current, [providerId]: result }));
        return result;
      } finally {
        inflightModels.current[providerId] = undefined;
      }
    })();

    inflightModels.current[providerId] = promise;
    return promise;
  }, [modelsByProvider]);

  return {
    providers,
    tools,
    agents,
    mcpServers,
    secrets,
    loading,
    mcpToolsByServer,
    loadMcpTools,
    loadMcpToolsForUrl,
    modelsByProvider,
    loadProviderModels,
  };
}
