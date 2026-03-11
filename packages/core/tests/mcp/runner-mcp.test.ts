import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelProvider, GenerateTextResult } from "../../src/types.js";

// Mock MCP SDK — must be before imports
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
  StreamableHTTPClientTransport: function () {
    return {};
  },
}));

import { createRunner } from "../../src/runner.js";
import { defineAgent } from "../../src/agent.js";

describe("Runner MCP Integration", () => {
  let callCount: number;

  const createMockModelProvider = (
    responses: Array<Partial<GenerateTextResult>>
  ): ModelProvider => {
    callCount = 0;
    return {
      generateText: async () => {
        const response =
          responses[callCount] ?? responses[responses.length - 1];
        callCount++;
        return {
          text: response.text ?? "",
          toolCalls: response.toolCalls ?? [],
          usage: response.usage ?? {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          finishReason: response.finishReason ?? "stop",
        };
      },
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.connect.mockResolvedValue(undefined);
    mockClient.close.mockResolvedValue(undefined);
    mockClient.listTools.mockResolvedValue({
      tools: [
        {
          name: "get_issues",
          description: "List GitHub issues",
          inputSchema: {
            type: "object",
            properties: {
              repo: { type: "string" },
              state: { type: "string", enum: ["open", "closed"] },
            },
            required: ["repo"],
          },
        },
        {
          name: "create_issue",
          description: "Create a new GitHub issue",
          inputSchema: {
            type: "object",
            properties: {
              repo: { type: "string" },
              title: { type: "string" },
              body: { type: "string" },
            },
            required: ["repo", "title"],
          },
        },
      ],
    });
  });

  it("resolves MCP tools for an agent", async () => {
    const runner = createRunner({
      modelProvider: createMockModelProvider([
        { text: "Found 3 open issues." },
      ]),
      mcp: {
        servers: {
          github: { url: "http://localhost:3001/mcp" },
        },
      },
    });

    runner.registerAgent(
      defineAgent({
        id: "issue-checker",
        name: "Issue Checker",
        systemPrompt: "Check GitHub issues",
        model: { provider: "openai", name: "gpt-4o" },
        tools: [{ type: "mcp", server: "github" }],
      })
    );

    const result = await runner.invoke("issue-checker", "Check my issues");
    expect(result.output).toBe("Found 3 open issues.");
    await runner.shutdown();
  });

  it("executes MCP tools in the agent loop", async () => {
    mockClient.callTool.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            { id: 1, title: "Bug report" },
            { id: 2, title: "Feature request" },
          ]),
        },
      ],
    });

    const runner = createRunner({
      modelProvider: createMockModelProvider([
        // First call: model wants to use a tool
        {
          text: "",
          toolCalls: [
            {
              id: "tc_1",
              name: "mcp__github__get_issues",
              args: { repo: "test/repo", state: "open" },
            },
          ],
          finishReason: "tool_calls",
        },
        // Second call: model responds with the tool results
        {
          text: "Found 2 issues: Bug report and Feature request.",
          finishReason: "stop",
        },
      ]),
      mcp: {
        servers: {
          github: { url: "http://localhost:3001/mcp" },
        },
      },
    });

    runner.registerAgent(
      defineAgent({
        id: "issue-checker",
        name: "Issue Checker",
        systemPrompt: "Check GitHub issues. Use tools to list issues.",
        model: { provider: "openai", name: "gpt-4o" },
        tools: [{ type: "mcp", server: "github" }],
      })
    );

    const result = await runner.invoke("issue-checker", "List open issues");

    expect(result.output).toBe(
      "Found 2 issues: Bug report and Feature request."
    );
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("mcp__github__get_issues");

    await runner.shutdown();
  });

  it("filters MCP tools by name in tool reference", async () => {
    const runner = createRunner({
      modelProvider: createMockModelProvider([{ text: "Done." }]),
      mcp: {
        servers: {
          github: { url: "http://localhost:3001/mcp" },
        },
      },
    });

    runner.registerAgent(
      defineAgent({
        id: "reader",
        name: "Reader",
        systemPrompt: "Read issues only",
        model: { provider: "openai", name: "gpt-4o" },
        tools: [
          { type: "mcp", server: "github", tools: ["get_issues"] },
        ],
      })
    );

    const result = await runner.invoke("reader", "test");
    expect(result.output).toBe("Done.");

    await runner.shutdown();
  });

  it("exposes MCP status after connecting", async () => {
    const runner = createRunner({
      modelProvider: createMockModelProvider([]),
      mcp: {
        servers: {
          github: { url: "http://localhost:3001/mcp" },
        },
      },
    });

    // Force connect
    await runner.mcp.connect();

    const status = runner.mcp.status();
    expect(status).toHaveLength(1);
    expect(status[0].name).toBe("github");
    expect(status[0].connected).toBe(true);
    expect(status[0].toolCount).toBe(2);

    const serverStatus = runner.mcp.serverStatus("github");
    expect(serverStatus?.toolNames).toEqual(["get_issues", "create_issue"]);

    await runner.shutdown();
  });

  it("mixes inline and MCP tools", async () => {
    const { z } = await import("zod");
    const { defineTool } = await import("../../src/tool.js");

    const myTool = defineTool({
      name: "local_tool",
      description: "A local tool",
      input: z.object({ value: z.string() }),
      async execute(input) {
        return { result: (input as any).value.toUpperCase() };
      },
    });

    const runner = createRunner({
      tools: [myTool],
      modelProvider: createMockModelProvider([{ text: "Combined result." }]),
      mcp: {
        servers: {
          github: { url: "http://localhost:3001/mcp" },
        },
      },
    });

    runner.registerAgent(
      defineAgent({
        id: "hybrid",
        name: "Hybrid Agent",
        systemPrompt: "Use both local and MCP tools",
        model: { provider: "openai", name: "gpt-4o" },
        tools: [
          { type: "inline", name: "local_tool" },
          { type: "mcp", server: "github", tools: ["get_issues"] },
        ],
      })
    );

    const result = await runner.invoke("hybrid", "Do both things");
    expect(result.output).toBe("Combined result.");

    await runner.shutdown();
  });
});
