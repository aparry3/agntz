import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { JsonFileStore } from "../../src/stores/json-file.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentDefinition, Message, ContextEntry, InvocationLog } from "../../src/types.js";

describe("JsonFileStore", () => {
  let admin: JsonFileStore;
  let store: JsonFileStore;
  let tempDir: string;
  const userId = "user_test";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agntz-test-"));
    admin = new JsonFileStore(tempDir);
    store = admin.forUser(userId);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ═══ AgentStore ═══

  describe("AgentStore", () => {
    const agent: AgentDefinition = {
      id: "test",
      name: "Test Agent",
      systemPrompt: "You are a test.",
      model: { provider: "openai", name: "gpt-5.4" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    it("stores and retrieves an agent", async () => {
      await store.putAgent(agent);
      const retrieved = await store.getAgent("test");
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe("test");
      expect(retrieved!.name).toBe("Test Agent");
    });

    it("returns null for unknown agent", async () => {
      const result = await store.getAgent("nonexistent");
      expect(result).toBeNull();
    });

    it("lists agents", async () => {
      await store.putAgent(agent);
      await store.putAgent({ ...agent, id: "test2", name: "Test 2" });
      const list = await store.listAgents();
      expect(list).toHaveLength(2);
    });

    it("deletes an agent", async () => {
      await store.putAgent(agent);
      await store.deleteAgent("test");
      const result = await store.getAgent("test");
      expect(result).toBeNull();
    });

    it("overwrites an existing agent", async () => {
      await store.putAgent(agent);
      await store.putAgent({ ...agent, name: "Updated Agent" });
      const retrieved = await store.getAgent("test");
      expect(retrieved!.name).toBe("Updated Agent");
    });

    it("sets updatedAt on put", async () => {
      await store.putAgent(agent);
      const retrieved = await store.getAgent("test");
      expect(retrieved!.updatedAt).toBeDefined();
      // updatedAt should be a recent ISO string
      const updatedAt = new Date(retrieved!.updatedAt!);
      expect(updatedAt.getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it("creates a version per put and listAgentVersions returns them newest first", async () => {
      await store.putAgent({ ...agent, name: "v1" });
      await store.putAgent({ ...agent, name: "v2" });
      await store.putAgent({ ...agent, name: "v3" });
      const versions = await store.listAgentVersions("test");
      expect(versions).toHaveLength(3);
      expect(versions[0].createdAt > versions[1].createdAt).toBe(true);
    });

    it("getAgentVersion returns the named version", async () => {
      await store.putAgent({ ...agent, name: "v1" });
      const versions = await store.listAgentVersions("test");
      const def = await store.getAgentVersion("test", versions[0].createdAt);
      expect(def?.name).toBe("v1");
    });

    it("activateAgentVersion changes the active version returned by getAgent", async () => {
      await store.putAgent({ ...agent, name: "v1" });
      await store.putAgent({ ...agent, name: "v2" });
      const versions = await store.listAgentVersions("test");
      // versions[0] is v2 (newest); activate v1 (versions[1])
      await store.activateAgentVersion("test", versions[1].createdAt);
      const active = await store.getAgent("test");
      expect(active?.name).toBe("v1");
    });
  });

  // ═══ SessionStore ═══

  describe("SessionStore", () => {
    const msg: Message = {
      role: "user",
      content: "Hello",
      timestamp: "2026-01-01T00:00:00Z",
    };

    it("appends and retrieves messages", async () => {
      await store.append("sess1", [msg]);
      const messages = await store.getMessages("sess1");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello");
    });

    it("returns empty array for unknown session", async () => {
      const messages = await store.getMessages("nonexistent");
      expect(messages).toEqual([]);
    });

    it("appends to existing session", async () => {
      await store.append("sess1", [msg]);
      await store.append("sess1", [{ ...msg, content: "World" }]);
      const messages = await store.getMessages("sess1");
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Hello");
      expect(messages[1].content).toBe("World");
    });

    it("deletes a session", async () => {
      await store.append("sess1", [msg]);
      await store.deleteSession("sess1");
      const messages = await store.getMessages("sess1");
      expect(messages).toEqual([]);
    });

    it("lists sessions", async () => {
      await store.append("sess1", [msg]);
      await store.append("sess2", [msg]);
      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.sessionId).sort()).toEqual(["sess1", "sess2"]);
    });

    it("tracks message count in session summary", async () => {
      await store.append("sess1", [msg, { ...msg, content: "Two" }]);
      const sessions = await store.listSessions();
      expect(sessions[0].messageCount).toBe(2);
    });
  });

  // ═══ ContextStore ═══

  describe("ContextStore", () => {
    const entry: ContextEntry = {
      contextId: "ctx1",
      agentId: "agent1",
      invocationId: "inv1",
      content: "Some context",
      createdAt: "2026-01-01T00:00:00Z",
    };

    it("adds and retrieves context", async () => {
      await store.addContext("ctx1", entry);
      const entries = await store.getContext("ctx1");
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe("Some context");
    });

    it("returns empty array for unknown context", async () => {
      const entries = await store.getContext("nonexistent");
      expect(entries).toEqual([]);
    });

    it("appends multiple entries", async () => {
      await store.addContext("ctx1", entry);
      await store.addContext("ctx1", { ...entry, content: "More context", invocationId: "inv2" });
      const entries = await store.getContext("ctx1");
      expect(entries).toHaveLength(2);
    });

    it("clears context", async () => {
      await store.addContext("ctx1", entry);
      await store.clearContext("ctx1");
      const entries = await store.getContext("ctx1");
      expect(entries).toEqual([]);
    });
  });

  // ═══ LogStore ═══

  describe("LogStore", () => {
    const logEntry: InvocationLog = {
      id: "inv_001",
      agentId: "agent1",
      input: "test input",
      output: "test output",
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      duration: 100,
      model: "openai/gpt-5.4",
      timestamp: "2026-01-01T00:00:00Z",
    };

    it("logs and retrieves entries", async () => {
      await store.log(logEntry);
      const logs = await store.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe("inv_001");
    });

    it("gets a specific log", async () => {
      await store.log(logEntry);
      const log = await store.getLog("inv_001");
      expect(log).toBeDefined();
      expect(log!.agentId).toBe("agent1");
    });

    it("returns null for unknown log", async () => {
      const log = await store.getLog("nonexistent");
      expect(log).toBeNull();
    });

    it("filters by agentId", async () => {
      await store.log(logEntry);
      await store.log({ ...logEntry, id: "inv_002", agentId: "agent2" });
      const logs = await store.getLogs({ agentId: "agent1" });
      expect(logs).toHaveLength(1);
      expect(logs[0].agentId).toBe("agent1");
    });

    it("filters by sessionId", async () => {
      await store.log({ ...logEntry, sessionId: "sess_a" });
      await store.log({ ...logEntry, id: "inv_002", sessionId: "sess_b" });
      const logs = await store.getLogs({ sessionId: "sess_a" });
      expect(logs).toHaveLength(1);
    });

    it("limits results", async () => {
      await store.log(logEntry);
      await store.log({ ...logEntry, id: "inv_002" });
      await store.log({ ...logEntry, id: "inv_003" });
      const logs = await store.getLogs({ limit: 2 });
      expect(logs).toHaveLength(2);
    });

    it("sorts by timestamp descending", async () => {
      await store.log({ ...logEntry, id: "inv_001", timestamp: "2026-01-01T00:00:00Z" });
      await store.log({ ...logEntry, id: "inv_002", timestamp: "2026-01-02T00:00:00Z" });
      await store.log({ ...logEntry, id: "inv_003", timestamp: "2026-01-03T00:00:00Z" });
      const logs = await store.getLogs();
      expect(logs[0].id).toBe("inv_003");
      expect(logs[2].id).toBe("inv_001");
    });

    it("handles since filter", async () => {
      await store.log({ ...logEntry, id: "inv_001", timestamp: "2026-01-01T00:00:00Z" });
      await store.log({ ...logEntry, id: "inv_002", timestamp: "2026-01-05T00:00:00Z" });
      const logs = await store.getLogs({ since: "2026-01-03T00:00:00Z" });
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe("inv_002");
    });
  });

  // ═══ Edge Cases ═══

  describe("Edge Cases", () => {
    it("handles IDs with special characters", async () => {
      const agent: AgentDefinition = {
        id: "my/agent:v1.0",
        name: "Special Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
      };
      await store.putAgent(agent);
      const retrieved = await store.getAgent("my/agent:v1.0");
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe("my/agent:v1.0");
    });

    it("handles deleting non-existent resources gracefully", async () => {
      // These should not throw
      await store.deleteAgent("nope");
      await store.deleteSession("nope");
      await store.clearContext("nope");
    });
  });

  describe("User isolation", () => {
    it("does not leak agents across users", async () => {
      const storeB = admin.forUser("user_b");

      await store.putAgent({
        id: "secret",
        name: "A",
        systemPrompt: "",
        model: { provider: "openai", name: "gpt-5.4" },
      });
      expect(await storeB.getAgent("secret")).toBeNull();
      expect((await storeB.listAgents()).length).toBe(0);
    });
  });

  describe("ApiKeyStore", () => {
    it("creates + resolves + revokes", async () => {
      const { record, rawKey } = await admin.createApiKey({ userId, name: "k" });
      const resolved = await admin.resolveApiKey(rawKey);
      expect(resolved).toEqual({ userId, keyId: record.id });
      await admin.revokeApiKey({ userId, keyId: record.id });
      expect(await admin.resolveApiKey(rawKey)).toBeNull();
    });
  });
});
