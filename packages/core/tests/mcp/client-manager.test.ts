import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for MCPClientManager.
 * We test the manager by providing pre-built mock clients via a factory function.
 */

// We need to test the public interface without real MCP connections.
// The approach: mock the entire module imports that MCPClientManager uses.

// Since MCPClientManager uses dynamic imports internally, we need to mock
// at the module level with vi.mock hoisting.

const mockClient = {
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
};

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: function () {
    return mockClient;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: function (url: any, opts: any) {
    return { type: "http", url };
  },
}));

import { MCPClientManager } from "../../src/mcp/client-manager.js";

describe("MCPClientManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.close.mockResolvedValue(undefined);
    mockClient.listTools.mockResolvedValue({
      tools: [
        {
          name: "read_file",
          description: "Read a file from disk",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "File path" },
            },
            required: ["path"],
          },
        },
        {
          name: "write_file",
          description: "Write content to a file",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      ],
    });
  });

  describe("initialize", () => {
    it("connects to HTTP servers and discovers tools", async () => {
      const manager = new MCPClientManager({
        github: {
          url: "http://localhost:3001/mcp",
          headers: { Authorization: "Bearer test" },
        },
      });

      await manager.initialize();

      expect(manager.initialized).toBe(true);
      expect(manager.getAllTools()).toHaveLength(2);
    });

    it("handles connection failures gracefully", async () => {
      mockClient.connect.mockRejectedValueOnce(new Error("Connection refused"));

      const manager = new MCPClientManager({
        broken: { url: "http://localhost:9999/mcp" },
      });

      await manager.initialize(); // Should not throw

      expect(manager.initialized).toBe(true);
      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0].connected).toBe(false);
      expect(status[0].error).toBe("Connection refused");
      expect(manager.getAllTools()).toHaveLength(0);
    });

    it("is idempotent — second call is a no-op", async () => {
      const manager = new MCPClientManager({
        test: { url: "http://localhost:3001/mcp" },
      });

      await manager.initialize();
      await manager.initialize();

      // connect is called once per initialization (only 1 server)
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe("getToolsFromServer", () => {
    it("returns all tools from a specific server", async () => {
      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      const tools = manager.getToolsFromServer("fs");
      expect(tools).toHaveLength(2);
    });

    it("filters tools by name", async () => {
      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      const tools = manager.getToolsFromServer("fs", ["read_file"]);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("read_file");
    });

    it("returns empty for unknown server", async () => {
      const manager = new MCPClientManager({});
      await manager.initialize();

      expect(manager.getToolsFromServer("nonexistent")).toHaveLength(0);
    });
  });

  describe("tool execution", () => {
    it("executes a tool and returns text content", async () => {
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: "file contents here" }],
      });

      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      const result = await manager.executeTool("fs", "read_file", {
        path: "/test.txt",
      });
      expect(result).toBe("file contents here");
    });

    it("handles multiple text parts", async () => {
      mockClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "line 1" },
          { type: "text", text: "line 2" },
        ],
      });

      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      const result = await manager.executeTool("fs", "read_file", {
        path: "/test.txt",
      });
      expect(result).toBe("line 1\nline 2");
    });

    it("throws for disconnected server", async () => {
      mockClient.connect.mockRejectedValueOnce(new Error("fail"));
      const manager = new MCPClientManager({
        broken: { url: "http://localhost:9999" },
      });
      await manager.initialize();

      await expect(
        manager.executeTool("broken", "read_file", {})
      ).rejects.toThrow('MCP server "broken" is not connected');
    });

    it("throws for unknown tool", async () => {
      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      await expect(
        manager.executeTool("fs", "nonexistent", {})
      ).rejects.toThrow('Tool "nonexistent" not found');
    });
  });

  describe("getStatus", () => {
    it("returns status for all servers", async () => {
      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      const status = manager.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0].connected).toBe(true);
      expect(status[0].toolCount).toBe(2);
    });
  });

  describe("getServerStatus", () => {
    it("returns detailed status for a specific server", async () => {
      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      const status = manager.getServerStatus("fs");
      expect(status).not.toBeNull();
      expect(status!.connected).toBe(true);
      expect(status!.toolNames).toEqual(["read_file", "write_file"]);
    });

    it("returns null for unknown server", async () => {
      const manager = new MCPClientManager({});
      await manager.initialize();
      expect(manager.getServerStatus("nonexistent")).toBeNull();
    });
  });

  describe("shutdown", () => {
    it("closes all connections", async () => {
      const manager = new MCPClientManager({
        fs: { url: "http://localhost:3001/mcp" },
      });
      await manager.initialize();

      await manager.shutdown();

      expect(mockClient.close).toHaveBeenCalled();
      expect(manager.initialized).toBe(false);
    });
  });
});
