import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRunner, defineAgent, defineTool, MemoryStore } from "@agent-runner/core";
import type { Runner } from "@agent-runner/core";
import { createStudioAPI } from "../src/server/api.js";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════

/** Mock model provider that returns deterministic responses */
const mockModelProvider = {
  async generateText(options: any) {
    return {
      text: `Mock response to: ${options.messages[options.messages.length - 1]?.content ?? "unknown"}`,
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      finishReason: "stop",
    };
  },
};

function createTestRunner(): Runner {
  const runner = createRunner({
    modelProvider: mockModelProvider as any,
  });
  return runner;
}

async function request(
  app: ReturnType<typeof createStudioAPI>,
  method: string,
  path: string,
  body?: unknown
) {
  const init: RequestInit = { method, headers: {} };
  if (body) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const res = await app.request(path, init);
  const json = await res.json();
  return { status: res.status, json };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("Studio API", () => {
  let runner: Runner;
  let api: ReturnType<typeof createStudioAPI>;

  beforeEach(() => {
    runner = createTestRunner();
    api = createStudioAPI(runner);
  });

  // ── Health ──────────────────────────────────────────────────────

  describe("GET /api/health", () => {
    it("returns ok", async () => {
      const { status, json } = await request(api, "GET", "/api/health");
      expect(status).toBe(200);
      expect(json.status).toBe("ok");
    });
  });

  // ── Agents ─────────────────────────────────────────────────────

  describe("Agents CRUD", () => {
    it("lists agents (empty)", async () => {
      const { status, json } = await request(api, "GET", "/api/agents");
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("creates an agent via PUT", async () => {
      const agent = {
        name: "Test Agent",
        systemPrompt: "You are a test agent.",
        model: { provider: "openai", name: "gpt-4o-mini" },
      };

      const { status, json } = await request(api, "PUT", "/api/agents/test-agent", agent);
      expect(status).toBe(201);
      expect(json.id).toBe("test-agent");
      expect(json.name).toBe("Test Agent");
      expect(json.createdAt).toBeTruthy();
      expect(json.updatedAt).toBeTruthy();
    });

    it("gets an agent by ID", async () => {
      // Create first
      await request(api, "PUT", "/api/agents/test-agent", {
        name: "Test Agent",
        systemPrompt: "You are a test agent.",
        model: { provider: "openai", name: "gpt-4o-mini" },
      });

      const { status, json } = await request(api, "GET", "/api/agents/test-agent");
      expect(status).toBe(200);
      expect(json.id).toBe("test-agent");
      expect(json.name).toBe("Test Agent");
    });

    it("returns 404 for nonexistent agent", async () => {
      const { status, json } = await request(api, "GET", "/api/agents/nonexistent");
      expect(status).toBe(404);
      expect(json.error).toContain("not found");
    });

    it("updates an existing agent", async () => {
      // Create
      await request(api, "PUT", "/api/agents/test-agent", {
        name: "Test Agent",
        systemPrompt: "Original prompt.",
        model: { provider: "openai", name: "gpt-4o-mini" },
      });

      // Update
      const { status, json } = await request(api, "PUT", "/api/agents/test-agent", {
        name: "Updated Agent",
        systemPrompt: "Updated prompt.",
        model: { provider: "anthropic", name: "claude-sonnet-4-20250514" },
      });

      expect(status).toBe(200);
      expect(json.name).toBe("Updated Agent");
      expect(json.systemPrompt).toBe("Updated prompt.");
    });

    it("deletes an agent", async () => {
      // Create
      await request(api, "PUT", "/api/agents/test-agent", {
        name: "Test Agent",
        systemPrompt: "You are a test agent.",
        model: { provider: "openai", name: "gpt-4o-mini" },
      });

      // Delete
      const { status, json } = await request(api, "DELETE", "/api/agents/test-agent");
      expect(status).toBe(200);
      expect(json.deleted).toBe(true);

      // Verify gone
      const { status: status2 } = await request(api, "GET", "/api/agents/test-agent");
      expect(status2).toBe(404);
    });

    it("returns 404 when deleting nonexistent agent", async () => {
      const { status } = await request(api, "DELETE", "/api/agents/nonexistent");
      expect(status).toBe(404);
    });

    it("returns 400 for invalid agent data", async () => {
      const { status, json } = await request(api, "PUT", "/api/agents/bad", {
        name: "Missing fields",
      });
      expect(status).toBe(400);
      expect(json.error).toContain("Missing required fields");
    });

    it("lists agents after creation", async () => {
      await request(api, "PUT", "/api/agents/agent-1", {
        name: "Agent 1",
        systemPrompt: "First",
        model: { provider: "openai", name: "gpt-4o-mini" },
      });
      await request(api, "PUT", "/api/agents/agent-2", {
        name: "Agent 2",
        systemPrompt: "Second",
        model: { provider: "openai", name: "gpt-4o-mini" },
      });

      const { json } = await request(api, "GET", "/api/agents");
      expect(json).toHaveLength(2);
    });
  });

  // ── Invocation (Playground) ────────────────────────────────────

  describe("POST /api/agents/:id/invoke", () => {
    it("invokes a registered agent", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      const { status, json } = await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
      });

      expect(status).toBe(200);
      expect(json.output).toContain("Mock response");
      expect(json.invocationId).toBeTruthy();
      expect(json.usage).toBeDefined();
      expect(json.duration).toBeGreaterThanOrEqual(0);
    });

    it("invokes a stored agent", async () => {
      // Create via API
      await request(api, "PUT", "/api/agents/stored-agent", {
        name: "Stored Agent",
        systemPrompt: "You are stored.",
        model: { provider: "openai", name: "gpt-4o-mini" },
      });

      const { status, json } = await request(api, "POST", "/api/agents/stored-agent/invoke", {
        input: "Test input",
      });

      expect(status).toBe(200);
      expect(json.output).toBeTruthy();
    });

    it("returns 404 for nonexistent agent invocation", async () => {
      const { status, json } = await request(api, "POST", "/api/agents/nonexistent/invoke", {
        input: "Hello",
      });
      expect(status).toBe(404);
    });

    it("returns 400 for missing input", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      const { status, json } = await request(api, "POST", "/api/agents/greeter/invoke", {});
      expect(status).toBe(400);
      expect(json.error).toContain("input");
    });

    it("supports session and context options", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      const { status, json } = await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
        sessionId: "sess_test",
        contextIds: ["ctx_1"],
        toolContext: { user: { id: "1" } },
      });

      expect(status).toBe(200);
      expect(json.output).toBeTruthy();
    });
  });

  // ── Tools ──────────────────────────────────────────────────────

  describe("Tools", () => {
    it("lists tools (empty)", async () => {
      const { status, json } = await request(api, "GET", "/api/tools");
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("lists registered tools", async () => {
      runner.registerTool(
        defineTool({
          name: "get_time",
          description: "Get the current time",
          input: z.object({}),
          async execute() {
            return { time: "12:00" };
          },
        })
      );

      const { status, json } = await request(api, "GET", "/api/tools");
      expect(status).toBe(200);
      expect(json).toHaveLength(1);
      expect(json[0].name).toBe("get_time");
    });

    it("gets a tool by name", async () => {
      runner.registerTool(
        defineTool({
          name: "get_time",
          description: "Get the current time",
          input: z.object({}),
          async execute() {
            return { time: "12:00" };
          },
        })
      );

      const { status, json } = await request(api, "GET", "/api/tools/get_time");
      expect(status).toBe(200);
      expect(json.name).toBe("get_time");
      expect(json.description).toBe("Get the current time");
    });

    it("returns 404 for nonexistent tool", async () => {
      const { status } = await request(api, "GET", "/api/tools/nonexistent");
      expect(status).toBe(404);
    });

    it("test-invokes a tool", async () => {
      runner.registerTool(
        defineTool({
          name: "add",
          description: "Add two numbers",
          input: z.object({ a: z.number(), b: z.number() }),
          async execute(input) {
            return { result: input.a + input.b };
          },
        })
      );

      const { status, json } = await request(api, "POST", "/api/tools/add/test", {
        input: { a: 2, b: 3 },
      });

      expect(status).toBe(200);
      expect(json.output).toEqual({ result: 5 });
      expect(json.duration).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Sessions ───────────────────────────────────────────────────

  describe("Sessions", () => {
    it("lists sessions (empty)", async () => {
      const { status, json } = await request(api, "GET", "/api/sessions");
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("lists sessions after invocation", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
        sessionId: "sess_test",
      });

      const { json } = await request(api, "GET", "/api/sessions");
      expect(json.length).toBeGreaterThanOrEqual(1);
    });

    it("gets session messages", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
        sessionId: "sess_msg_test",
      });

      const { status, json } = await request(api, "GET", "/api/sessions/sess_msg_test");
      expect(status).toBe(200);
      expect(json.sessionId).toBe("sess_msg_test");
      expect(json.messages).toHaveLength(2); // user + assistant
    });

    it("deletes a session", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
        sessionId: "sess_del",
      });

      const { status } = await request(api, "DELETE", "/api/sessions/sess_del");
      expect(status).toBe(200);

      // Session messages should be empty after delete
      const { json } = await request(api, "GET", "/api/sessions/sess_del");
      expect(json.messages).toHaveLength(0);
    });
  });

  // ── Context ────────────────────────────────────────────────────

  describe("Context", () => {
    it("gets empty context", async () => {
      const { status, json } = await request(api, "GET", "/api/context/nonexistent");
      expect(status).toBe(200);
      expect(json.entries).toEqual([]);
      expect(json.count).toBe(0);
    });

    it("adds a context entry", async () => {
      const { status, json } = await request(api, "POST", "/api/context/test-ctx", {
        content: "Some context data",
        agentId: "my-agent",
      });

      expect(status).toBe(201);
      expect(json.contextId).toBe("test-ctx");
      expect(json.content).toBe("Some context data");
      expect(json.agentId).toBe("my-agent");
    });

    it("reads back context entries", async () => {
      await request(api, "POST", "/api/context/test-ctx", {
        content: "Entry 1",
      });
      await request(api, "POST", "/api/context/test-ctx", {
        content: "Entry 2",
      });

      const { json } = await request(api, "GET", "/api/context/test-ctx");
      expect(json.count).toBe(2);
      expect(json.entries[0].content).toBe("Entry 1");
      expect(json.entries[1].content).toBe("Entry 2");
      expect(json.size).toBe("Entry 1".length + "Entry 2".length);
    });

    it("clears context", async () => {
      await request(api, "POST", "/api/context/test-ctx", {
        content: "Entry 1",
      });

      const { status } = await request(api, "DELETE", "/api/context/test-ctx");
      expect(status).toBe(200);

      const { json } = await request(api, "GET", "/api/context/test-ctx");
      expect(json.count).toBe(0);
    });

    it("returns 400 for missing content", async () => {
      const { status } = await request(api, "POST", "/api/context/test-ctx", {});
      expect(status).toBe(400);
    });
  });

  // ── Logs ───────────────────────────────────────────────────────

  describe("Logs", () => {
    it("lists logs (empty)", async () => {
      const { status, json } = await request(api, "GET", "/api/logs");
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("lists logs after invocation", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
      });

      const { json } = await request(api, "GET", "/api/logs");
      expect(json.length).toBe(1);
      expect(json[0].agentId).toBe("greeter");
      expect(json[0].input).toBe("Hello!");
    });

    it("gets a specific log", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      await request(api, "POST", "/api/agents/greeter/invoke", {
        input: "Hello!",
      });

      const { json: logs } = await request(api, "GET", "/api/logs");
      const logId = logs[0].id;

      const { status, json } = await request(api, "GET", `/api/logs/${logId}`);
      expect(status).toBe(200);
      expect(json.id).toBe(logId);
      expect(json.agentId).toBe("greeter");
    });

    it("returns 404 for nonexistent log", async () => {
      const { status } = await request(api, "GET", "/api/logs/nonexistent");
      expect(status).toBe(404);
    });

    it("filters logs by agentId", async () => {
      runner.registerAgent(
        defineAgent({
          id: "agent-a",
          name: "Agent A",
          systemPrompt: "A",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );
      runner.registerAgent(
        defineAgent({
          id: "agent-b",
          name: "Agent B",
          systemPrompt: "B",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      await request(api, "POST", "/api/agents/agent-a/invoke", { input: "From A" });
      await request(api, "POST", "/api/agents/agent-b/invoke", { input: "From B" });

      const { json } = await request(api, "GET", "/api/logs?agentId=agent-a");
      expect(json.length).toBe(1);
      expect(json[0].agentId).toBe("agent-a");
    });
  });

  // ── MCP ────────────────────────────────────────────────────────

  describe("MCP", () => {
    it("lists MCP servers (empty when no MCP configured)", async () => {
      const { status, json } = await request(api, "GET", "/api/mcp/servers");
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });

    it("returns 404 for nonexistent MCP server", async () => {
      const { status } = await request(api, "GET", "/api/mcp/servers/nonexistent");
      expect(status).toBe(404);
    });

    it("lists tools for MCP server (empty)", async () => {
      const { status, json } = await request(api, "GET", "/api/mcp/servers/test/tools");
      expect(status).toBe(200);
      expect(json).toEqual([]);
    });
  });

  // ── Evals ──────────────────────────────────────────────────────

  describe("Evals", () => {
    it("runs eval with inline test cases", async () => {
      runner.registerAgent(
        defineAgent({
          id: "greeter",
          name: "Greeter",
          systemPrompt: "You greet people.",
          model: { provider: "openai", name: "gpt-4o-mini" },
        })
      );

      const { status, json } = await request(api, "POST", "/api/evals/greeter/run", {
        testCases: [
          {
            name: "basic greeting",
            input: "Hello!",
            assertions: [{ type: "contains", value: "mock response" }],
          },
        ],
      });

      expect(status).toBe(200);
      expect(json.agentId).toBe("greeter");
      expect(json.summary.total).toBe(1);
      expect(json.summary.passed).toBe(1);
    });

    it("returns 404 for nonexistent agent eval", async () => {
      const { status } = await request(api, "POST", "/api/evals/nonexistent/run", {});
      expect(status).toBe(404);
    });
  });
});
