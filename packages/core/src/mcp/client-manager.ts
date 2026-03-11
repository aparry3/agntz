import type { MCPServerConfig, ToolInfo } from "../types.js";

/**
 * MCP Tool — an executable tool discovered from an MCP server.
 * Stored in the MCPClientManager's internal registry.
 */
export interface MCPTool {
  /** Tool name (as declared by the MCP server) */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
  /** Which MCP server this tool came from */
  serverName: string;
  /** Execute the tool via the MCP server */
  execute(input: unknown): Promise<unknown>;
}

/**
 * Represents a connection to a single MCP server.
 */
interface MCPConnection {
  serverName: string;
  config: MCPServerConfig;
  tools: MCPTool[];
  connected: boolean;
  error?: string;
  /** The underlying MCP client (from @modelcontextprotocol/sdk) */
  client: any;
  /** Transport handle for cleanup */
  transport: any;
}

/**
 * MCPClientManager — manages connections to multiple MCP servers,
 * discovers their tools, and provides a unified interface for tool execution.
 *
 * Supports HTTP (Streamable HTTP / SSE) transport.
 */
export class MCPClientManager {
  private connections = new Map<string, MCPConnection>();
  private _initialized = false;

  constructor(private servers: Record<string, MCPServerConfig>) {}

  /**
   * Connect to all configured MCP servers and discover tools.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    const connectPromises = Object.entries(this.servers).map(
      async ([name, config]) => {
        try {
          await this.connectServer(name, config);
        } catch (err) {
          // Store the error but don't fail initialization
          this.connections.set(name, {
            serverName: name,
            config,
            tools: [],
            connected: false,
            error: err instanceof Error ? err.message : String(err),
            client: null,
            transport: null,
          });
        }
      }
    );

    await Promise.all(connectPromises);
    this._initialized = true;
  }

  /**
   * Connect to a single MCP server.
   */
  private async connectServer(
    name: string,
    config: MCPServerConfig
  ): Promise<void> {
    const { Client } = await import(
      "@modelcontextprotocol/sdk/client/index.js"
    );

    const client = new Client({
      name: "agent-runner",
      version: "0.1.0",
    });

    let transport: any;

    if (config.url) {
      // HTTP/SSE transport
      const { StreamableHTTPClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/streamableHttp.js"
      );
      transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: config.headers
          ? { headers: config.headers }
          : undefined,
      });
    } else {
      throw new Error(
        `MCP server "${name}" must have a 'url' configured for HTTP transport.`
      );
    }

    await client.connect(transport);

    // Discover tools
    const toolsResult = await client.listTools();
    const tools: MCPTool[] = (toolsResult.tools ?? []).map((t: any) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      serverName: name,
      execute: async (input: unknown) => {
        const result = await client.callTool({
          name: t.name,
          arguments: input as Record<string, unknown>,
        });
        // MCP tools return content array — extract text
        if (Array.isArray(result.content)) {
          const textParts = result.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text);
          if (textParts.length === 1) return textParts[0];
          if (textParts.length > 1) return textParts.join("\n");
          // If no text parts, return the raw content
          return result.content;
        }
        return result.content;
      },
    }));

    this.connections.set(name, {
      serverName: name,
      config,
      tools,
      connected: true,
      client,
      transport,
    });
  }

  /**
   * Get all discovered tools across all connected MCP servers.
   */
  getAllTools(): MCPTool[] {
    const tools: MCPTool[] = [];
    for (const conn of this.connections.values()) {
      if (conn.connected) {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  /**
   * Get tools from a specific MCP server.
   * Optionally filter to specific tool names.
   */
  getToolsFromServer(serverName: string, toolNames?: string[]): MCPTool[] {
    const conn = this.connections.get(serverName);
    if (!conn?.connected) return [];

    if (toolNames?.length) {
      const nameSet = new Set(toolNames);
      return conn.tools.filter((t) => nameSet.has(t.name));
    }

    return conn.tools;
  }

  /**
   * Execute an MCP tool by its fully qualified name (server:toolName).
   */
  async executeTool(
    serverName: string,
    toolName: string,
    input: unknown
  ): Promise<unknown> {
    const conn = this.connections.get(serverName);
    if (!conn?.connected) {
      throw new Error(
        `MCP server "${serverName}" is not connected.`
      );
    }

    const tool = conn.tools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(
        `Tool "${toolName}" not found on MCP server "${serverName}".`
      );
    }

    return tool.execute(input);
  }

  /**
   * Get connection status for all servers.
   */
  getStatus(): Array<{
    name: string;
    connected: boolean;
    toolCount: number;
    error?: string;
  }> {
    return Array.from(this.connections.values()).map((conn) => ({
      name: conn.serverName,
      connected: conn.connected,
      toolCount: conn.tools.length,
      error: conn.error,
    }));
  }

  /**
   * Get a specific server's connection status.
   */
  getServerStatus(name: string) {
    const conn = this.connections.get(name);
    if (!conn) return null;
    return {
      name: conn.serverName,
      connected: conn.connected,
      toolCount: conn.tools.length,
      toolNames: conn.tools.map((t) => t.name),
      error: conn.error,
    };
  }

  /**
   * Disconnect from all MCP servers. Call on shutdown.
   */
  async shutdown(): Promise<void> {
    const closePromises = Array.from(this.connections.values()).map(
      async (conn) => {
        if (conn.client && conn.connected) {
          try {
            await conn.client.close();
          } catch {
            // Ignore close errors
          }
        }
      }
    );
    await Promise.all(closePromises);
    this.connections.clear();
    this._initialized = false;
  }

  get initialized(): boolean {
    return this._initialized;
  }
}
