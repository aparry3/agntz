import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStore } from "@agntz/core";
import { createMemrez } from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { agntz, tool, z } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures/agents");

// Fixture agents reference a local `add` tool; register a noop so load succeeds.
const noopTools = [
	tool({
		name: "add",
		description: "Adds two numbers",
		input: z.object({ a: z.number(), b: z.number() }),
		execute: async () => 0,
	}),
];

describe("agntz() — admin resources", () => {
	it("exposes client.sessions backed by the runner store", async () => {
		const store = new MemoryStore().forUser("local");
		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			store,
		});

		// Seed through the same store the runner uses.
		await store.getOrCreateSession("s1");
		await store.append("s1", [
			{ role: "user", content: "hi", timestamp: new Date().toISOString() },
		]);

		const sessions = await client.sessions.list();
		expect(sessions.map((s) => s.sessionId)).toContain("s1");

		const detail = await client.sessions.get("s1");
		expect(detail.sessionId).toBe("s1");
		expect(detail.messages).toHaveLength(1);

		await client.sessions.delete("s1");
		const after = await client.sessions.list();
		expect(after.map((s) => s.sessionId)).not.toContain("s1");
	});

	it("exposes client.memory only when a memrez handle is supplied", async () => {
		const withoutMemrez = await agntz({
			agents: fixturesDir,
			tools: noopTools,
		});
		expect(withoutMemrez.memory).toBeUndefined();

		const memrez = createMemrez();
		const now = new Date().toISOString();
		// Seed via the store directly so no LLM reasoner is invoked.
		await memrez.store.putEntry({
			id: "m1",
			scope: "app/user/u1",
			content: "Likes email.",
			topics: ["prefs"],
			type: "fact",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});

		const client = await agntz({
			agents: fixturesDir,
			tools: noopTools,
			memrez,
		});
		expect(client.memory).toBeDefined();

		const listed = await client.memory?.list(["app/user/u1"]);
		expect(listed?.map((e) => e.id)).toEqual(["m1"]);

		const del = await client.memory?.deleteScope(
			["app/user/u1"],
			"app/user/u1",
		);
		expect(del?.deleted).toBe(1);
		expect(await client.memory?.list(["app/user/u1"])).toHaveLength(0);
	});
});
