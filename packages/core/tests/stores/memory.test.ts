import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/stores/memory.js";
import type {
	AgentDefinition,
	ContextEntry,
	InvocationLog,
	Message,
} from "../../src/types.js";

describe("MemoryStore", () => {
	let admin: MemoryStore;
	let store: MemoryStore;
	const userId = "user_test";

	beforeEach(() => {
		admin = new MemoryStore({ strict: true });
		store = admin.forUser(userId);
	});

	describe("AgentStore", () => {
		const agent: AgentDefinition = {
			id: "test",
			name: "Test Agent",
			systemPrompt: "You are a test.",
			model: { provider: "openai", name: "gpt-5.4" },
		};

		it("stores and retrieves an agent", async () => {
			await store.putAgent(agent);
			const retrieved = await store.getAgent("test");
			expect(retrieved?.id).toBe("test");
		});

		it("lists agents", async () => {
			await store.putAgent(agent);
			await store.putAgent({ ...agent, id: "test2", name: "Test 2" });
			expect(await store.listAgents()).toHaveLength(2);
		});

		it("throws if called on a strict-mode unscoped store", async () => {
			await expect(admin.getAgent("test")).rejects.toThrow(/user not set/);
		});

		it("auto-scopes to __default__ without explicit user for ergonomics", async () => {
			const ergonomic = new MemoryStore();
			await ergonomic.putAgent({
				id: "quick",
				name: "Quick",
				systemPrompt: "",
				model: { provider: "openai", name: "gpt-5.4" },
			});
			expect((await ergonomic.getAgent("quick"))?.name).toBe("Quick");
		});

		it("activates a prior version", async () => {
			await store.putAgent({ ...agent, name: "v1" });
			await store.putAgent({ ...agent, name: "v2" });
			const versions = await store.listAgentVersions("test");
			await store.activateAgentVersion("test", versions[1].createdAt);
			expect((await store.getAgent("test"))?.name).toBe("v1");
		});
	});

	describe("SessionStore", () => {
		const msg: Message = {
			role: "user",
			content: "Hello",
			timestamp: "2026-01-01T00:00:00Z",
		};

		it("appends and retrieves messages", async () => {
			await store.append("sess1", [msg]);
			expect(await store.getMessages("sess1")).toHaveLength(1);
		});

		it("returns empty for unknown session", async () => {
			expect(await store.getMessages("nope")).toEqual([]);
		});

		it("appends to existing session", async () => {
			await store.append("sess1", [msg]);
			await store.append("sess1", [{ ...msg, content: "World" }]);
			expect(await store.getMessages("sess1")).toHaveLength(2);
		});
	});

	describe("ContextStore", () => {
		const entry: ContextEntry = {
			contextId: "ctx1",
			agentId: "a",
			invocationId: "inv1",
			content: "ctx",
			createdAt: "2026-01-01T00:00:00Z",
		};

		it("adds + retrieves context", async () => {
			await store.addContext("ctx1", entry);
			expect(await store.getContext("ctx1")).toHaveLength(1);
		});

		it("clears context", async () => {
			await store.addContext("ctx1", entry);
			await store.clearContext("ctx1");
			expect(await store.getContext("ctx1")).toEqual([]);
		});
	});

	describe("LogStore", () => {
		const log: InvocationLog = {
			id: "inv_001",
			agentId: "a",
			input: "i",
			output: "o",
			toolCalls: [],
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
			duration: 10,
			model: "openai/gpt-5.4",
			timestamp: "2026-01-01T00:00:00Z",
		};

		it("logs + retrieves", async () => {
			await store.log(log);
			expect(await store.getLogs()).toHaveLength(1);
			expect((await store.getLog("inv_001"))?.agentId).toBe("a");
		});

		it("filters by agentId", async () => {
			await store.log(log);
			await store.log({ ...log, id: "inv_002", agentId: "b" });
			expect(await store.getLogs({ agentId: "a" })).toHaveLength(1);
		});
	});

	describe("User isolation", () => {
		it("does not leak agents across users", async () => {
			const storeB = admin.forUser("user_b");
			await store.putAgent({
				id: "secret",
				name: "A's agent",
				systemPrompt: "",
				model: { provider: "openai", name: "gpt-5.4" },
			});
			expect(await storeB.getAgent("secret")).toBeNull();
			expect(await storeB.listAgents()).toEqual([]);
		});

		it("does not leak sessions across users", async () => {
			const storeB = admin.forUser("user_b");
			await store.append("sess_shared", [
				{ role: "user", content: "hi", timestamp: "2026-01-01T00:00:00Z" },
			]);
			expect(await storeB.getMessages("sess_shared")).toEqual([]);
			await expect(
				storeB.append("sess_shared", [
					{ role: "user", content: "x", timestamp: "2026-01-01T00:00:00Z" },
				]),
			).rejects.toThrow(/different user/);
		});
	});

	describe("ApiKeyStore", () => {
		it("creates, resolves, and revokes", async () => {
			const { record, rawKey } = await admin.createApiKey({
				userId,
				name: "default",
			});
			expect(rawKey).toMatch(/^ar_live_/);
			expect(record.userId).toBe(userId);

			expect(await admin.resolveApiKey(rawKey)).toEqual({
				userId,
				keyId: record.id,
			});

			await admin.revokeApiKey({ userId, keyId: record.id });
			expect(await admin.resolveApiKey(rawKey)).toBeNull();
		});

		it("returns null for unknown keys", async () => {
			expect(await admin.resolveApiKey("ar_live_bogus")).toBeNull();
		});

		it("listApiKeys returns only the target user's keys", async () => {
			await admin.createApiKey({ userId, name: "A-key" });
			await admin.createApiKey({ userId: "user_b", name: "B-key" });
			expect((await admin.listApiKeys(userId)).map((k) => k.name)).toEqual([
				"A-key",
			]);
			expect((await admin.listApiKeys("user_b")).map((k) => k.name)).toEqual([
				"B-key",
			]);
		});
	});
});
