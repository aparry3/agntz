import type { AgentDefinition } from "@agntz/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresStore } from "../src/postgres-store.js";

/**
 * Integration tests for PostgresStore. Runs against a real Postgres instance
 * when DATABASE_URL is set; skipped otherwise (CI should provide a test DB).
 *
 * We dropped the previous mock-pool tests after the multi-tenancy migration —
 * the mock diverged significantly from real Postgres behavior (WHERE clauses,
 * composite PKs, cascades) and was more liability than value. SQLite and
 * MemoryStore tests cover the contract; this file verifies the Postgres-
 * specific SQL actually works.
 */
const url = process.env.DATABASE_URL;
const hasDb = !!url;

describe.skipIf(!hasDb)("PostgresStore (integration)", () => {
	let admin: PostgresStore;
	const userId = `user_test_${Date.now()}`;

	beforeAll(async () => {
		admin = new PostgresStore({
			connection: url!,
			tablePrefix: `art_${Date.now()}_`,
		});
	});

	afterAll(async () => {
		await admin.close();
	});

	it("scopes agents to the user", async () => {
		const store = admin.forUser(userId);
		const agent: AgentDefinition = {
			id: "test",
			name: "Test",
			systemPrompt: "",
			model: { provider: "openai", name: "gpt-5.4" },
		};
		await store.putAgent(agent);
		expect((await store.getAgent("test"))?.name).toBe("Test");

		const storeB = admin.forUser(`user_b_${Date.now()}`);
		expect(await storeB.getAgent("test")).toBeNull();
	});

	it("creates, resolves, and revokes API keys", async () => {
		const { record, rawKey } = await admin.createApiKey({ userId, name: "k" });
		expect(rawKey).toMatch(/^ar_live_/);

		expect(await admin.resolveApiKey(rawKey)).toEqual({
			userId,
			keyId: record.id,
		});

		await admin.revokeApiKey({ userId, keyId: record.id });
		expect(await admin.resolveApiKey(rawKey)).toBeNull();
	});

	it("throws on scoped methods when unscoped", async () => {
		await expect(admin.getAgent("x")).rejects.toThrow(/user not set/);
	});
});
