import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/memory.js";

describe("MemoryStore hosted capabilities", () => {
	let admin: MemoryStore;
	const userId = "user_test";

	beforeEach(() => {
		admin = new MemoryStore({ strict: true });
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

	describe("NamespaceRootStore", () => {
		it("normalizes and stores roots by user", async () => {
			await admin.addNamespaceRoot(userId, "team/project");
			await admin.addNamespaceRoot("user_b", "other");

			expect(await admin.listNamespaceRoots(userId)).toEqual(["team/project"]);
			expect(await admin.listNamespaceRoots("user_b")).toEqual(["other"]);

			await admin.removeNamespaceRoot(userId, "team/project");
			expect(await admin.listNamespaceRoots(userId)).toEqual([]);
		});
	});

	describe("WebhookDeliveryStore", () => {
		it("tracks pending deliveries in scoped stores", async () => {
			const store = admin.forUser(userId);
			await store.insert({
				id: "whd_1",
				runId: "run_1",
				callbackUrl: "https://example.com/webhook",
				secretName: "webhook",
				payload: { type: "reply" },
			});

			expect(await store.listPending()).toMatchObject([
				{ id: "whd_1", attempts: 0, status: "pending" },
			]);

			await store.incrementAttempt("whd_1", "retry");
			await store.updateStatus("whd_1", "delivered");
			expect(await store.listPending()).toEqual([]);
		});
	});
});
