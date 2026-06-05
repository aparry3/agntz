import { _resetCryptoKeyCache } from "@agntz/core";
import type {
	AgentDefinition,
	ContextEntry,
	InvocationLog,
	Message,
	SecretDefinition,
} from "@agntz/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteStore } from "../src/sqlite-store.js";

// 32-byte (64 hex char) test key. Lazy load means simply setting the env
// var before any encryptSecret call is sufficient; reset between tests for
// the "wrong key" assertion.
const TEST_KEY_A =
	"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_KEY_B =
	"fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

describe("SqliteStore", () => {
	let admin: SqliteStore;
	let store: SqliteStore;
	const userId = "user_test";

	beforeEach(() => {
		process.env.AGNTZ_SECRET_KEY = TEST_KEY_A;
		_resetCryptoKeyCache();
		admin = new SqliteStore(":memory:");
		store = admin.forUser(userId);
	});

	afterEach(() => {
		admin.close();
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
			model: { provider: "openai", name: "gpt-5.4-mini" },
		};

		it("should put and get an agent", async () => {
			await store.putAgent(agent);
			const result = await store.getAgent("test-agent");
			expect(result).not.toBeNull();
			expect(result?.id).toBe("test-agent");
			expect(result?.name).toBe("Test Agent");
			expect(result?.systemPrompt).toBe("You are a test agent.");
		});

		it("should return null for non-existent agent", async () => {
			const result = await store.getAgent("nonexistent");
			expect(result).toBeNull();
		});

		it("should list agents", async () => {
			await store.putAgent(agent);
			await store.putAgent({
				...agent,
				id: "agent-2",
				name: "Agent Two",
			});

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
			expect(result?.name).toBe("Updated Agent");
			expect(result?.description).toBe("Updated description");
		});

		it("should delete an agent", async () => {
			await store.putAgent(agent);
			await store.deleteAgent("test-agent");
			const result = await store.getAgent("test-agent");
			expect(result).toBeNull();
		});

		it("creates a version per put and exposes them via listAgentVersions", async () => {
			await store.putAgent({ ...agent, name: "v1" });
			await store.putAgent({ ...agent, name: "v2" });
			await store.putAgent({ ...agent, name: "v3" });
			const versions = await store.listAgentVersions("test-agent");
			expect(versions).toHaveLength(3);
			expect(versions[0].createdAt > versions[1].createdAt).toBe(true);
		});

		it("activateAgentVersion changes the active version returned by getAgent", async () => {
			await store.putAgent({ ...agent, name: "v1" });
			await store.putAgent({ ...agent, name: "v2" });
			const versions = await store.listAgentVersions("test-agent");
			await store.activateAgentVersion("test-agent", versions[1].createdAt);
			const active = await store.getAgent("test-agent");
			expect(active?.name).toBe("v1");
		});

		it("should handle agent with full definition", async () => {
			const fullAgent: AgentDefinition = {
				...agent,
				version: "1.0.0",
				examples: [{ input: "hello", output: "hi" }],
				tools: [{ type: "inline", name: "test_tool" }],
				tags: ["test", "example"],
				metadata: { custom: "value" },
			};

			await store.putAgent(fullAgent);
			const result = await store.getAgent("test-agent");
			expect(result?.examples).toEqual([{ input: "hello", output: "hi" }]);
			expect(result?.tools).toEqual([{ type: "inline", name: "test_tool" }]);
			expect(result?.tags).toEqual(["test", "example"]);
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
			expect(result[0].toolCalls?.[0].name).toBe("lookup");
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

		it("dual-writes multimodal ContentBlock[] content and reads it back as blocks", async () => {
			const blocks = [
				{ type: "text", text: "how's my form?" },
				{
					type: "image",
					base64: "QUFBQQ==",
					mediaType: "image/jpeg" as const,
				},
			];
			await store.append("sess-mm", [
				{ role: "user", content: blocks, timestamp: now } as Message,
				{ role: "assistant", content: "Great squat!", timestamp: now },
			]);

			// Inspect raw rows: legacy content column has flattened text; the new
			// content_blocks column carries the JSON payload.
			const raw = admin.database
				.prepare(
					`SELECT role, content, content_blocks FROM messages
           WHERE session_id = ? ORDER BY id`,
				)
				.all("sess-mm") as Array<{
				role: string;
				content: string;
				content_blocks: string | null;
			}>;
			expect(raw[0].role).toBe("user");
			expect(raw[0].content).toBe("how's my form? [image]");
			expect(raw[0].content_blocks).not.toBeNull();
			expect(JSON.parse(raw[0].content_blocks as string)).toEqual(blocks);
			// Assistant string content writes NULL to content_blocks.
			expect(raw[1].content_blocks).toBeNull();
			expect(raw[1].content).toBe("Great squat!");

			// Reads return the blocks array on the multimodal message and a plain
			// string on the assistant reply.
			const out = await store.getMessages("sess-mm");
			expect(out).toHaveLength(2);
			expect(Array.isArray(out[0].content)).toBe(true);
			expect(out[0].content).toEqual(blocks);
			expect(out[1].content).toBe("Great squat!");
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
			model: "gpt-5.4-mini",
			timestamp: now,
		};

		it("should log and retrieve an entry", async () => {
			await store.log(logEntry);
			const result = await store.getLog("log-1");
			expect(result).not.toBeNull();
			expect(result?.agentId).toBe("test-agent");
			expect(result?.input).toBe("Hello");
			expect(result?.output).toBe("Hi there!");
			expect(result?.usage.totalTokens).toBe(15);
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

			// Ensure no overlap
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
			expect(result?.toolCalls).toHaveLength(1);
			expect(result?.toolCalls[0].name).toBe("lookup");
		});

		it("should handle logs with errors", async () => {
			await store.log({ ...logEntry, id: "log-err", error: "Something broke" });
			const result = await store.getLog("log-err");
			expect(result?.error).toBe("Something broke");
		});

		it("should persist status for cancel/fail audit", async () => {
			await store.log({
				...logEntry,
				id: "log-cancelled",
				status: "cancelled",
			});
			await store.log({ ...logEntry, id: "log-failed", status: "failed" });
			await store.log({ ...logEntry, id: "log-default" });

			const cancelled = await store.getLog("log-cancelled");
			const failed = await store.getLog("log-failed");
			const defaulted = await store.getLog("log-default");

			expect(cancelled?.status).toBe("cancelled");
			expect(failed?.status).toBe("failed");
			expect(defaulted?.status).toBeUndefined();
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
		it("should accept string path as constructor shorthand", () => {
			const s = new SqliteStore(":memory:");
			expect(s).toBeInstanceOf(SqliteStore);
			s.close();
		});

		it("should expose underlying database", () => {
			expect(store.database).toBeDefined();
		});

		it("should work with WAL disabled", () => {
			const s = new SqliteStore({ path: ":memory:", wal: false });
			expect(s).toBeInstanceOf(SqliteStore);
			s.close();
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
				model: { provider: "openai", name: "gpt-5.4-mini" },
			};

			// Run multiple operations simultaneously
			await Promise.all([
				store.putAgent(agent),
				store.append("sess-c", [
					{
						role: "user",
						content: "msg1",
						timestamp: new Date().toISOString(),
					},
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

			// Verify all wrote successfully
			expect(await store.getAgent("concurrent")).not.toBeNull();
			expect(await store.getMessages("sess-c")).toHaveLength(1);
			expect(await store.getContext("ctx-c")).toHaveLength(1);
			expect(await store.getLog("log-c")).not.toBeNull();
		});
	});

	// ═══════════════════════════════════════════════════════════════════
	// SecretStore
	// ═══════════════════════════════════════════════════════════════════

	describe("SecretStore", () => {
		const secret: SecretDefinition = {
			name: "test_token",
			value: "sk-abcd-12345678",
			description: "test token",
		};

		it("puts and gets metadata without exposing the value", async () => {
			await store.putSecret(secret);
			const meta = await store.getSecretMetadata("test_token");
			expect(meta).not.toBeNull();
			expect(meta?.name).toBe("test_token");
			expect(meta?.lastFour).toBe("5678");
			expect(meta?.description).toBe("test token");
			// The metadata object MUST NOT carry the plaintext or ciphertext.
			expect(meta as unknown as { value?: unknown }).not.toHaveProperty(
				"value",
			);
		});

		it("round-trips the value via getSecretValue", async () => {
			await store.putSecret(secret);
			const value = await store.getSecretValue("test_token");
			expect(value).toBe("sk-abcd-12345678");
		});

		it("returns null for an unknown secret", async () => {
			expect(await store.getSecretMetadata("nope")).toBeNull();
			expect(await store.getSecretValue("nope")).toBeNull();
		});

		it("upserts: writing twice updates updated_at and value", async () => {
			await store.putSecret(secret);
			const first = await store.getSecretMetadata("test_token");
			// Wait long enough for nextTimestamp() to advance (it's monotonic
			// to the millisecond).
			await new Promise((r) => setTimeout(r, 5));
			await store.putSecret({
				name: "test_token",
				value: "sk-different-87654321",
				description: "updated",
			});
			const second = await store.getSecretMetadata("test_token");
			expect(second?.lastFour).toBe("4321");
			expect(second?.description).toBe("updated");
			expect(second?.updatedAt > first?.updatedAt).toBe(true);
			// Value should round-trip the new plaintext.
			expect(await store.getSecretValue("test_token")).toBe(
				"sk-different-87654321",
			);
		});

		it("listSecrets returns metadata sorted by name, no values", async () => {
			await store.putSecret({ name: "alpha", value: "value-aaaa1111" });
			await store.putSecret({ name: "charlie", value: "value-cccc3333" });
			await store.putSecret({ name: "bravo", value: "value-bbbb2222" });

			const list = await store.listSecrets();
			expect(list).toHaveLength(3);
			expect(list.map((s) => s.name)).toEqual(["alpha", "bravo", "charlie"]);
			// No leaked values.
			for (const m of list) {
				expect(m as unknown as { value?: unknown }).not.toHaveProperty("value");
				expect(m.lastFour.length).toBe(4);
			}
		});

		it("deleteSecret removes the row", async () => {
			await store.putSecret(secret);
			await store.deleteSecret("test_token");
			expect(await store.getSecretMetadata("test_token")).toBeNull();
			expect(await store.getSecretValue("test_token")).toBeNull();
		});

		it("scopes secrets by user — userA cannot see userB's secrets", async () => {
			const storeA = admin.forUser("user_a");
			const storeB = admin.forUser("user_b");
			await storeA.putSecret({
				name: "shared_name",
				value: "value-from-A1111",
			});
			await storeB.putSecret({
				name: "shared_name",
				value: "value-from-B2222",
			});

			// Each user sees only their own row in list.
			const listA = await storeA.listSecrets();
			const listB = await storeB.listSecrets();
			expect(listA).toHaveLength(1);
			expect(listB).toHaveLength(1);
			expect(listA[0].lastFour).toBe("1111");
			expect(listB[0].lastFour).toBe("2222");

			// Round-trip values stay isolated.
			expect(await storeA.getSecretValue("shared_name")).toBe(
				"value-from-A1111",
			);
			expect(await storeB.getSecretValue("shared_name")).toBe(
				"value-from-B2222",
			);

			// Deleting from A doesn't affect B.
			await storeA.deleteSecret("shared_name");
			expect(await storeA.getSecretMetadata("shared_name")).toBeNull();
			expect(await storeB.getSecretMetadata("shared_name")).not.toBeNull();
		});

		it("decryption fails loudly when the master key has changed", async () => {
			await store.putSecret(secret);
			// Verify normal round-trip first.
			expect(await store.getSecretValue("test_token")).toBe("sk-abcd-12345678");

			// Swap the key, reset the lazy cache, and assert decryption throws.
			process.env.AGNTZ_SECRET_KEY = TEST_KEY_B;
			_resetCryptoKeyCache();
			await expect(store.getSecretValue("test_token")).rejects.toThrow();
		});
	});
});
