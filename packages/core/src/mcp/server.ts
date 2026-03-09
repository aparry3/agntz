import type { Runner } from "../runner.js";

/**
 * Options for creating an MCP server from a runner.
 */
export interface MCPServerOptions {
  /** Server name (default: "agent-runner") */
  name?: string;
  /** Server version (default: "0.1.0") */
  version?: string;
  /** Only expose specific agent IDs. If omitted, all agents are exposed. */
  agentIds?: string[];
}

/**
 * Create an MCP server that exposes agent-runner agents as MCP tools.
 *
 * Each registered agent becomes a callable tool:
 * - Tool name: `invoke_{agentId}`
 * - Input: `{ input: string, sessionId?: string }`
 * - Output: The agent's response text
 *
 * Usage with stdio transport:
 * ```typescript
 * import { createRunner } from "agent-runner";
 * import { createMCPServer } from "agent-runner/mcp-server";
 *
 * const runner = createRunner({ ... });
 * const server = createMCPServer(runner);
 * await server.start();
 * ```
 *
 * Note: This requires the @modelcontextprotocol/sdk package.
 */
export async function createMCPServer(runner: Runner, options: MCPServerOptions = {}) {
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");

  const serverName = options.name ?? "agent-runner";
  const serverVersion = options.version ?? "0.1.0";

  const server = new Server(
    { name: serverName, version: serverVersion },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List tools handler — expose agents as invocable tools
  server.setRequestHandler(
    { method: "tools/list" } as any,
    async () => {
      const agents = await runner.agents.listAgents();
      const filtered = options.agentIds
        ? agents.filter((a) => options.agentIds!.includes(a.id))
        : agents;

      return {
        tools: filtered.map((agent) => ({
          name: `invoke_${agent.id}`,
          description: agent.description ?? `Invoke the "${agent.name}" agent`,
          inputSchema: {
            type: "object",
            properties: {
              input: {
                type: "string",
                description: "The input/question to send to the agent",
              },
              sessionId: {
                type: "string",
                description: "Optional session ID for conversational continuity",
              },
            },
            required: ["input"],
          },
        })),
      };
    },
  );

  // Call tool handler — invoke the agent
  server.setRequestHandler(
    { method: "tools/call" } as any,
    async (request: any) => {
      const { name, arguments: args } = request.params;

      // Extract agent ID from tool name
      const agentId = name.replace(/^invoke_/, "");
      const input = args?.input ?? "";
      const sessionId = args?.sessionId;

      try {
        const result = await runner.invoke(agentId, input, { sessionId });
        return {
          content: [
            {
              type: "text",
              text: result.output,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return {
    /** The underlying MCP Server instance */
    server,

    /**
     * Start the MCP server with stdio transport.
     * This connects stdin/stdout and begins processing requests.
     */
    async start() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      return server;
    },

    /**
     * Connect to a custom transport (e.g., HTTP/SSE).
     */
    async connect(transport: any) {
      await server.connect(transport);
      return server;
    },

    /**
     * Shut down the server.
     */
    async close() {
      await server.close();
    },
  };
}
