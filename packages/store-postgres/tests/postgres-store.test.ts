import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type {
  AgentDefinition,
  Message,
  ContextEntry,
  InvocationLog,
} from "@agent-runner/core";

// ═══════════════════════════════════════════════════════════════════════
// Mock pg.Pool — defined BEFORE vi.mock due to hoisting
// ═══════════════════════════════════════════════════════════════════════

/**
 * In-memory mock that simulates PostgreSQL behavior for unit testing.
 * For integration tests against a real Postgres, set DATABASE_URL env var.
 */

interface MockRow {
  [key: string]: unknown;
}

const createMockPool = () => {
  const agents = new Map<string, MockRow>();
  const sessions = new Map<string, MockRow>();
  let messages: MockRow[] = [];
  let contextEntries: MockRow[] = [];
  const logs = new Map<string, MockRow>();
  let schemaVersion = 0;
  let messageIdCounter = 1;
  let contextIdCounter = 1;
  let migrated = false;

  const queryFn = async (sql: string, params?: unknown[]) => {
    const trimmed = sql.trim().toLowerCase();

    // Schema version check
    if (trimmed.includes("select version from") && trimmed.includes("schema_version")) {
      if (!migrated) {
        throw new Error("relation does not exist");
      }
      return { rows: [{ version: schemaVersion }] };
    }

    // Migration DDL — just mark as migrated
    if (trimmed.includes("create table") || trimmed.includes("create index") || (trimmed.includes("insert into") && trimmed.includes("schema_version"))) {
      migrated = true;
      schemaVersion = 1;
      return { rows: [] };
    }

    // ─── Agents ───
    if (trimmed.includes("select definition from") && trimmed.includes("agents")) {
      const agent = agents.get(params![0] as string);
      return { rows: agent ? [{ definition: agent.definition }] : [] };
    }

    if (trimmed.includes("select id, name, description from") && trimmed.includes("agents")) {
      const rows = Array.from(agents.values())
        .map((a) => ({ id: a.id, name: a.name, description: a.description }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { rows };
    }

    if (trimmed.includes("insert into") && trimmed.includes("agents")) {
      const [id, name, description, version, definition, created_at, updated_at] = params!;
      agents.set(id as string, {
        id, name, description, version,
        definition: typeof definition === "string" ? JSON.parse(definition) : definition,
        created_at, updated_at,
      });
      return { rows: [] };
    }

    if (trimmed.includes("delete from") && trimmed.includes("agents")) {
      agents.delete(params![0] as string);
      return { rows: [] };
    }

    // ─── Sessions ───
    if (trimmed.includes("insert into") && trimmed.includes("sessions") && !trimmed.includes("messages")) {
      const [id, created_at, updated_at] = params!;
      sessions.set(id as string, {
        id, agent_id: null, created_at, updated_at,
      });
      return { rows: [] };
    }

    if (trimmed.includes("delete from") && trimmed.includes("sessions") && !trimmed.includes("messages")) {
      sessions.delete(params![0] as string);
      return { rows: [] };
    }

    // ─── Messages ───
    if (trimmed.includes("select role, content") && trimmed.includes("messages")) {
      const sessionId = params![0] as string;
      const rows = messages
        .filter((m) => m.session_id === sessionId)
        .map((m) => ({
          role: m.role,
          content: m.content,
          tool_calls: m.tool_calls,
          tool_call_id: m.tool_call_id,
          timestamp: m.timestamp,
        }));
      return { rows };
    }

    if (trimmed.includes("insert into") && trimmed.includes("messages")) {
      const [session_id, role, content, tool_calls, tool_call_id, timestamp] = params!;
      messages.push({
        id: messageIdCounter++,
        session_id, role, content,
        tool_calls: tool_calls ? (typeof tool_calls === "string" ? JSON.parse(tool_calls) : tool_calls) : null,
        tool_call_id, timestamp,
      });
      return { rows: [] };
    }

    if (trimmed.includes("delete from") && trimmed.includes("messages")) {
      const sessionId = params![0] as string;
      messages = messages.filter((m) => m.session_id !== sessionId);
      return { rows: [] };
    }

    // ─── Sessions list ───
    if (trimmed.includes("select s.id") && trimmed.includes("sessions")) {
      const agentId = params?.[0] as string | undefined;
      const sessionList = Array.from(sessions.values())
        .filter((s) => !agentId || s.agent_id === agentId)
        .map((s) => ({
          id: s.id,
          agent_id: s.agent_id,
          created_at: s.created_at,
          updated_at: s.updated_at,
          message_count: String(messages.filter((m) => m.session_id === s.id).length),
        }))
        .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      return { rows: sessionList };
    }

    // ─── Context ───
    if (trimmed.includes("select context_id") && trimmed.includes("context_entries")) {
      const contextId = params![0] as string;
      const rows = contextEntries
        .filter((e) => e.context_id === contextId)
        .map((e) => ({
          context_id: e.context_id,
          agent_id: e.agent_id,
          invocation_id: e.invocation_id,
          content: e.content,
          created_at: e.created_at,
        }));
      return { rows };
    }

    if (trimmed.includes("insert into") && trimmed.includes("context_entries")) {
      const [context_id, agent_id, invocation_id, content, created_at] = params!;
      contextEntries.push({
        id: contextIdCounter++,
        context_id, agent_id, invocation_id, content, created_at,
      });
      return { rows: [] };
    }

    if (trimmed.includes("delete from") && trimmed.includes("context_entries")) {
      const contextId = params![0] as string;
      contextEntries = contextEntries.filter((e) => e.context_id !== contextId);
      return { rows: [] };
    }

    // ─── Logs ───
    if (trimmed.includes("insert into") && trimmed.includes("invocation_logs")) {
      const [id, agent_id, session_id, input, output, tool_calls,
        prompt_tokens, completion_tokens, total_tokens, duration, model, error, timestamp] = params!;
      logs.set(id as string, {
        id, agent_id, session_id, input, output,
        tool_calls: typeof tool_calls === "string" ? JSON.parse(tool_calls) : tool_calls,
        prompt_tokens, completion_tokens, total_tokens,
        duration, model, error, timestamp,
      });
      return { rows: [] };
    }

    if (trimmed.includes("select * from") && trimmed.includes("invocation_logs") && trimmed.includes("where id =")) {
      const log = logs.get(params![0] as string);
      return { rows: log ? [log] : [] };
    }

    if (trimmed.includes("select * from") && trimmed.includes("invocation_logs") && trimmed.includes("where 1=1")) {
      let rows = Array.from(logs.values());

      // Apply filters from params
      let paramIdx = 0;
      if (trimmed.includes("agent_id =")) {
        const val = params![paramIdx++] as string;
        rows = rows.filter((r) => r.agent_id === val);
      }
      if (trimmed.includes("session_id =")) {
        const val = params![paramIdx++] as string;
        rows = rows.filter((r) => r.session_id === val);
      }
      if (trimmed.includes("timestamp >=")) {
        const val = params![paramIdx++] as string;
        rows = rows.filter((r) => String(r.timestamp) >= val);
      }

      // Sort newest first
      rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));

      if (trimmed.includes("limit")) {
        const limitVal = params![paramIdx++] as number;
        const offsetVal = trimmed.includes("offset") ? (params![paramIdx++] as number) : 0;
        rows = rows.slice(offsetVal, offsetVal + limitVal);
      }

      return { rows };
    }

    // BEGIN/COMMIT/ROLLBACK — no-op
    if (trimmed === "begin" || trimmed === "commit" || trimmed === "rollback") {
      return { rows: [] };
    }

    return { rows: [] };
  };

  return {
    query: queryFn,
    connect: async () => ({
      query: queryFn,
      release: () => {},
    }),
    end: async () => {},
  };
};

// vi.mock must be hoisted — uses factory function to avoid class reference issues
vi.mock("pg", () => {
  const PoolClass = function (this: ReturnType<typeof createMockPool>) {
    const mock = createMockPool();
    this.query = mock.query;
    this.connect = mock.connect;
    this.end = mock.end;
  } as unknown as { new (...args: unknown[]): ReturnType<typeof createMockPool> };

  return {
    default: { Pool: PoolClass },
    Pool: PoolClass,
  };
});

import { PostgresStore } from "../src/postgres-store.js";

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════

describe("PostgresStore", () => {
  let store: PostgresStore;

  beforeEach(async () => {
    store = new PostgresStore("postgresql://test:test@localhost:5432/test");
    // Wait for migration to complete
    await new Promise((r) => setTimeout(r, 10));
  });

  afterEach(async () => {
    await store.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  // AgentStore
  // ═══════════════════════════════════════════════════════════════════

  describe("AgentStore", () => {
    const agent: AgentDefinition = {
      id: "test-agent",
      name: "Test Agent",
      description: "A test agent",
      systemPrompt: "You are a test agent.",
      model: { provider: "openai", name: "gpt-4o-mini" },
    };

    it("should put and get an agent", async () => {
      await store.putAgent(agent);
      const result = await store.getAgent("test-agent");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("test-agent");
      expect(result!.name).toBe("Test Agent");
      expect(result!.systemPrompt).toBe("You are a test agent.");
    });

    it("should return null for non-existent agent", async () => {
      const result = await store.getAgent("nonexistent");
      expect(result).toBeNull();
    });

    it("should list agents", async () => {
      await store.putAgent(agent);
      await store.putAgent({ ...agent, id: "agent-2", name: "Agent Two" });

      const list = await store.listAgents();
      expect(list).toHaveLength(2);
      expect(list.map((a) => a.id)).toContain("test-agent");
      expect(list.map((a) => a.id)).toContain("agent-2");
    });

    it("should update an existing agent", async () => {
      await store.putAgent(agent);
      await store.putAgent({
        ...agent,
        name: "Updated Agent",
        description: "Updated description",
      });

      const result = await store.getAgent("test-agent");
      expect(result!.name).toBe("Updated Agent");
      expect(result!.description).toBe("Updated description");
    });

    it("should delete an agent", async () => {
      await store.putAgent(agent);
      await store.deleteAgent("test-agent");
      const result = await store.getAgent("test-agent");
      expect(result).toBeNull();
    });

    it("should handle agent with full definition", async () => {
      const fullAgent: AgentDefinition = {
        ...agent,
        version: "1.0.0",
        examples: [{ input: "hello", output: "hi" }],
        tools: [{ type: "inline", name: "test_tool" }],
        tags: ["test", "example"],
        metadata: { custom: "value" },
        eval: {
          rubric: "Be helpful",
          testCases: [{ input: "test", expectedOutput: "response" }],
        },
      };

      await store.putAgent(fullAgent);
      const result = await store.getAgent("test-agent");
      expect(result!.examples).toEqual([{ input: "hello", output: "hi" }]);
      expect(result!.tools).toEqual([{ type: "inline", name: "test_tool" }]);
      expect(result!.tags).toEqual(["test", "example"]);
      expect(result!.eval?.rubric).toBe("Be helpful");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SessionStore
  // ═══════════════════════════════════════════════════════════════════

  describe("SessionStore", () => {
    const now = new Date().toISOString();

    const messages: Message[] = [
      { role: "user", content: "Hello", timestamp: now },
      { role: "assistant", content: "Hi there!", timestamp: now },
    ];

    it("should append and get messages", async () => {
      await store.append("sess-1", messages);
      const result = await store.getMessages("sess-1");
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toBe("Hello");
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toBe("Hi there!");
    });

    it("should return empty array for non-existent session", async () => {
      const result = await store.getMessages("nonexistent");
      expect(result).toEqual([]);
    });

    it("should append to existing session", async () => {
      await store.append("sess-1", messages);
      await store.append("sess-1", [
        { role: "user", content: "Follow up", timestamp: now },
      ]);

      const result = await store.getMessages("sess-1");
      expect(result).toHaveLength(3);
      expect(result[2].content).toBe("Follow up");
    });

    it("should preserve message order", async () => {
      const orderedMessages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `Message ${i}`,
        timestamp: now,
      }));

      await store.append("sess-order", orderedMessages);
      const result = await store.getMessages("sess-order");
      expect(result).toHaveLength(10);
      result.forEach((msg, i) => {
        expect(msg.content).toBe(`Message ${i}`);
      });
    });

    it("should handle messages with tool calls", async () => {
      const toolMessages: Message[] = [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "tc-1",
              name: "lookup",
              input: { query: "test" },
              output: { result: "found" },
              duration: 100,
            },
          ],
          timestamp: now,
        },
        {
          role: "tool",
          content: '{"result": "found"}',
          toolCallId: "tc-1",
          timestamp: now,
        },
      ];

      await store.append("sess-tools", toolMessages);
      const result = await store.getMessages("sess-tools");
      expect(result[0].toolCalls).toHaveLength(1);
      expect(result[0].toolCalls![0].name).toBe("lookup");
      expect(result[1].toolCallId).toBe("tc-1");
    });

    it("should delete a session and its messages", async () => {
      await store.append("sess-del", messages);
      await store.deleteSession("sess-del");

      const result = await store.getMessages("sess-del");
      expect(result).toEqual([]);

      const sessions = await store.listSessions();
      expect(sessions.find((s) => s.sessionId === "sess-del")).toBeUndefined();
    });

    it("should list sessions", async () => {
      await store.append("sess-a", messages);
      await store.append("sess-b", [messages[0]]);

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ContextStore
  // ═══════════════════════════════════════════════════════════════════

  describe("ContextStore", () => {
    const now = new Date().toISOString();

    const entry: ContextEntry = {
      contextId: "ctx-1",
      agentId: "researcher",
      invocationId: "inv-1",
      content: "Research findings about MCP",
      createdAt: now,
    };

    it("should add and get context entries", async () => {
      await store.addContext("ctx-1", entry);
      const result = await store.getContext("ctx-1");
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Research findings about MCP");
      expect(result[0].agentId).toBe("researcher");
    });

    it("should return empty array for non-existent context", async () => {
      const result = await store.getContext("nonexistent");
      expect(result).toEqual([]);
    });

    it("should accumulate entries", async () => {
      await store.addContext("ctx-1", entry);
      await store.addContext("ctx-1", {
        ...entry,
        invocationId: "inv-2",
        content: "More findings",
      });

      const result = await store.getContext("ctx-1");
      expect(result).toHaveLength(2);
    });

    it("should clear context", async () => {
      await store.addContext("ctx-1", entry);
      await store.addContext("ctx-1", {
        ...entry,
        invocationId: "inv-2",
        content: "More",
      });

      await store.clearContext("ctx-1");
      const result = await store.getContext("ctx-1");
      expect(result).toEqual([]);
    });

    it("should isolate contexts by ID", async () => {
      await store.addContext("ctx-a", { ...entry, contextId: "ctx-a" });
      await store.addContext("ctx-b", {
        ...entry,
        contextId: "ctx-b",
        content: "Different context",
      });

      const a = await store.getContext("ctx-a");
      const b = await store.getContext("ctx-b");
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0].content).not.toBe(b[0].content);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // LogStore
  // ═══════════════════════════════════════════════════════════════════

  describe("LogStore", () => {
    const now = new Date().toISOString();

    const logEntry: InvocationLog = {
      id: "log-1",
      agentId: "test-agent",
      sessionId: "sess-1",
      input: "Hello",
      output: "Hi there!",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      duration: 500,
      model: "gpt-4o-mini",
      timestamp: now,
    };

    it("should log and retrieve an entry", async () => {
      await store.log(logEntry);
      const result = await store.getLog("log-1");
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("test-agent");
      expect(result!.input).toBe("Hello");
      expect(result!.output).toBe("Hi there!");
      expect(result!.usage.totalTokens).toBe(15);
    });

    it("should return null for non-existent log", async () => {
      const result = await store.getLog("nonexistent");
      expect(result).toBeNull();
    });

    it("should filter logs by agentId", async () => {
      await store.log(logEntry);
      await store.log({ ...logEntry, id: "log-2", agentId: "other-agent" });

      const result = await store.getLogs({ agentId: "test-agent" });
      expect(result).toHaveLength(1);
      expect(result[0].agentId).toBe("test-agent");
    });

    it("should filter logs by sessionId", async () => {
      await store.log(logEntry);
      await store.log({ ...logEntry, id: "log-2", sessionId: "sess-2" });

      const result = await store.getLogs({ sessionId: "sess-1" });
      expect(result).toHaveLength(1);
    });

    it("should filter logs by since", async () => {
      const old = "2020-01-01T00:00:00.000Z";
      await store.log({ ...logEntry, id: "log-old", timestamp: old });
      await store.log(logEntry);

      const result = await store.getLogs({ since: "2024-01-01T00:00:00.000Z" });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("log-1");
    });

    it("should support limit and offset", async () => {
      for (let i = 0; i < 5; i++) {
        await store.log({
          ...logEntry,
          id: `log-${i}`,
          timestamp: `2026-03-0${i + 1}T00:00:00.000Z`,
        });
      }

      const page1 = await store.getLogs({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = await store.getLogs({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const ids1 = page1.map((l) => l.id);
      const ids2 = page2.map((l) => l.id);
      expect(ids1).not.toEqual(ids2);
    });

    it("should handle logs with tool calls", async () => {
      const logWithTools: InvocationLog = {
        ...logEntry,
        id: "log-tools",
        toolCalls: [
          {
            id: "tc-1",
            name: "lookup",
            input: { query: "test" },
            output: { result: "found" },
            duration: 100,
          },
        ],
      };

      await store.log(logWithTools);
      const result = await store.getLog("log-tools");
      expect(result!.toolCalls).toHaveLength(1);
      expect(result!.toolCalls[0].name).toBe("lookup");
    });

    it("should handle logs with errors", async () => {
      await store.log({ ...logEntry, id: "log-err", error: "Something broke" });
      const result = await store.getLog("log-err");
      expect(result!.error).toBe("Something broke");
    });

    it("should return logs newest first", async () => {
      await store.log({
        ...logEntry,
        id: "log-old",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
      await store.log({
        ...logEntry,
        id: "log-new",
        timestamp: "2026-03-01T00:00:00.000Z",
      });

      const result = await store.getLogs();
      expect(result[0].id).toBe("log-new");
      expect(result[1].id).toBe("log-old");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  describe("Lifecycle", () => {
    it("should accept string connection as constructor shorthand", () => {
      const s = new PostgresStore("postgresql://test:test@localhost:5432/test");
      expect(s).toBeInstanceOf(PostgresStore);
    });

    it("should expose underlying pool", () => {
      expect(store.pgPool).toBeDefined();
    });

    it("should support custom table prefix", async () => {
      const s = new PostgresStore({
        connection: "postgresql://test:test@localhost:5432/test",
        tablePrefix: "myapp_",
      });
      expect(s).toBeInstanceOf(PostgresStore);
      await s.close();
    });

    it("should support skipMigration option", () => {
      const s = new PostgresStore({
        connection: "postgresql://test:test@localhost:5432/test",
        skipMigration: true,
      });
      expect(s).toBeInstanceOf(PostgresStore);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Cross-store consistency
  // ═══════════════════════════════════════════════════════════════════

  describe("Cross-store consistency", () => {
    it("should handle concurrent operations", async () => {
      const agent: AgentDefinition = {
        id: "concurrent",
        name: "Concurrent Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-4o-mini" },
      };

      await Promise.all([
        store.putAgent(agent),
        store.append("sess-c", [
          { role: "user", content: "msg1", timestamp: new Date().toISOString() },
        ]),
        store.addContext("ctx-c", {
          contextId: "ctx-c",
          agentId: "concurrent",
          invocationId: "inv-c",
          content: "context data",
          createdAt: new Date().toISOString(),
        }),
        store.log({
          id: "log-c",
          agentId: "concurrent",
          input: "test",
          output: "ok",
          toolCalls: [],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          duration: 10,
          model: "test",
          timestamp: new Date().toISOString(),
        }),
      ]);

      expect(await store.getAgent("concurrent")).not.toBeNull();
      expect(await store.getMessages("sess-c")).toHaveLength(1);
      expect(await store.getContext("ctx-c")).toHaveLength(1);
      expect(await store.getLog("log-c")).not.toBeNull();
    });
  });
});
