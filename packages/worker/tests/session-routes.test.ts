import { MemoryStore } from "@agntz/stores/memory";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function headers(userId = "u1") {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
		"X-User-Id": userId,
	} as const;
}

describe("worker session routes", () => {
	it("lists, reads, and deletes sessions tenant-scoped", async () => {
		const store = new MemoryStore();
		const scoped = store.forUser("u1");
		await scoped.getOrCreateSession("s1");
		await scoped.append("s1", [
			{ role: "user", content: "hi", timestamp: new Date().toISOString() },
		]);
		const app = createWorkerAPI({ store, internalSecret: SECRET });

		const list = await app.request("/sessions", { headers: headers() });
		expect(list.status).toBe(200);
		const listBody = (await list.json()) as {
			sessions: Array<{ sessionId: string }>;
		};
		expect(listBody.sessions.map((s) => s.sessionId)).toEqual(["s1"]);

		const detail = await app.request("/sessions/s1", { headers: headers() });
		expect(detail.status).toBe(200);
		const detailBody = (await detail.json()) as {
			sessionId: string;
			messages: unknown[];
		};
		expect(detailBody.sessionId).toBe("s1");
		expect(detailBody.messages).toHaveLength(1);

		const del = await app.request("/sessions/s1", {
			method: "DELETE",
			headers: headers(),
		});
		expect(del.status).toBe(204);

		const after = await app.request("/sessions", { headers: headers() });
		const afterBody = (await after.json()) as { sessions: unknown[] };
		expect(afterBody.sessions).toHaveLength(0);
	});

	it("isolates sessions by tenant and requires auth", async () => {
		const store = new MemoryStore();
		await store.forUser("u1").getOrCreateSession("s1");
		const app = createWorkerAPI({ store, internalSecret: SECRET });

		// A different tenant sees none of u1's sessions.
		const other = await app.request("/sessions", { headers: headers("u2") });
		expect(((await other.json()) as { sessions: unknown[] }).sessions).toEqual(
			[],
		);

		// No internal secret → 401.
		const noAuth = await app.request("/sessions");
		expect(noAuth.status).toBe(401);
	});
});
