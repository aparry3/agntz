import { MemoryStore } from "@agntz/core";
import {
	DeterministicReasoner,
	InMemoryMemoryStore,
	createMemrez,
} from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

async function makeApp() {
	const store = new MemoryStore();
	const memrez = createMemrez({
		store: new InMemoryMemoryStore(),
		reasoner: new DeterministicReasoner(),
	});
	const app = createWorkerAPI({ store, internalSecret: SECRET, memrez });
	const { rawKey } = await store
		.forUser("u1")
		.createApiKey({ userId: "u1", name: "test" });
	return { app, store, memrez, auth: { Authorization: `Bearer ${rawKey}` } };
}

describe("POST /agents/import", () => {
	it("validates cross-agent refs inside the same batch and stores manifests", async () => {
		const { app, store, auth } = await makeApp();
		const child = `id: child
kind: llm
model: { provider: openai, name: gpt-5.4-mini }
instruction: "Child"
`;
		const parent = `id: parent
kind: sequential
steps:
  - ref: child
`;

		const res = await app.request("/agents/import", {
			method: "POST",
			headers: { ...auth, "Content-Type": "application/json" },
			body: JSON.stringify({
				agents: [
					{ id: "parent", manifest: parent, sourcePath: "agents/parent.yaml" },
					{ id: "child", manifest: child, sourcePath: "agents/child.yaml" },
				],
				dryRun: false,
			}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { counts: Record<string, number> };
		expect(body.counts.create).toBe(2);
		const stored = await store.forUser("u1").getAgent("parent");
		expect(stored?.metadata?.manifest).toBe(parent);
	});
});

describe("POST /sessions/import", () => {
	it("stores a session snapshot with messages and agent id", async () => {
		const { app, store, auth } = await makeApp();
		const res = await app.request("/sessions/import", {
			method: "POST",
			headers: { ...auth, "Content-Type": "application/json" },
			body: JSON.stringify({
				sessions: [
					{
						sessionId: "sess_1",
						agentId: "parent",
						createdAt: "2026-06-01T00:00:00.000Z",
						updatedAt: "2026-06-01T00:01:00.000Z",
						messages: [
							{
								role: "user",
								content: "hello",
								timestamp: "2026-06-01T00:00:00.000Z",
							},
						],
					},
				],
			}),
		});

		expect(res.status).toBe(200);
		const sessions = await store.forUser("u1").listSessions("parent");
		expect(sessions).toHaveLength(1);
		expect(sessions[0].sessionId).toBe("sess_1");
		const messages = await store.forUser("u1").getMessages("sess_1");
		expect(messages[0].content).toBe("hello");
	});
});

describe("POST /memory/import", () => {
	it("upserts memory entries into the configured memrez store", async () => {
		const { app, memrez, auth } = await makeApp();
		const entry = {
			id: "mem_1",
			scope: "user:u1",
			content: "Prefers concise answers.",
			topics: ["core"],
			type: "preference",
			status: "active",
			createdAt: "2026-06-01T00:00:00.000Z",
			updatedAt: "2026-06-01T00:00:00.000Z",
		};

		const res = await app.request("/memory/import", {
			method: "POST",
			headers: { ...auth, "Content-Type": "application/json" },
			body: JSON.stringify({ entries: [entry] }),
		});

		expect(res.status).toBe(200);
		const stored = await memrez.store.getEntry("mem_1");
		expect(stored?.content).toBe(entry.content);
		expect(stored?.topics).toEqual(["core"]);
	});
});
