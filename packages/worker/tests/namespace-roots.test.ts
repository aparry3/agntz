import { MemoryStore } from "@agntz/core";
import { createMemrez } from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { signInternalAuthToken } from "../src/middleware/internal-auth.js";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

async function setup() {
	const store = new MemoryStore();
	const memrez = createMemrez();
	const now = new Date().toISOString();
	const put = (id: string, scope: string) =>
		memrez.store.putEntry({
			id,
			scope,
			content: id,
			topics: ["t"],
			type: "fact",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});
	await put("m_t1", "t1/user/1");
	await put("m_t2", "t2/user/1");
	const app = createWorkerAPI({
		store,
		internalSecret: SECRET,
		memrez,
		resources: { memory: memrez.provider() },
	});
	return { store, memrez, app };
}

function bearer(rawKey: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${rawKey}`,
	};
}

function adminHeaders(): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
		"X-Agntz-Internal-Auth": signInternalAuthToken(
			{
				actorUserId: "admin",
				tenantId: "admin",
				permissions: ["namespace:unbounded"],
			},
			SECRET,
		),
	};
}

const ids = (body: unknown) =>
	((body as { entries: { id: string }[] }).entries ?? []).map((e) => e.id);

describe("namespace-root bounding", () => {
	it("bounds an API-key tenant to its registered roots", async () => {
		const { store, app } = await setup();
		const { rawKey } = await store.createApiKey({ userId: "t1", name: "k" });
		await store.addNamespaceRoot("t1", "t1");

		const within = await app.request("/memory/entries?grants=t1/user/1", {
			headers: bearer(rawKey),
		});
		expect(within.status).toBe(200);
		expect(ids(await within.json())).toEqual(["m_t1"]);

		// A grant outside the tenant's roots is rejected before reaching memrez.
		const outside = await app.request("/memory/entries?grants=t2/user/1", {
			headers: bearer(rawKey),
		});
		expect(outside.status).toBe(400);
	});

	it("returns 403 when the tenant has no registered roots", async () => {
		const { store, app } = await setup();
		const { rawKey } = await store.createApiKey({ userId: "t3", name: "k" });
		const res = await app.request("/memory/entries?grants=t3/user/1", {
			headers: bearer(rawKey),
		});
		expect(res.status).toBe(403);
	});

	it("lets a super-admin identity read any scope (unbounded)", async () => {
		const { app } = await setup();
		const res = await app.request("/memory/entries?grants=t2/user/1", {
			headers: adminHeaders(),
		});
		expect(res.status).toBe(200);
		expect(ids(await res.json())).toEqual(["m_t2"]);
	});

	it("bounds scope deletion to the tenant's roots", async () => {
		const { store, memrez, app } = await setup();
		const { rawKey } = await store.createApiKey({ userId: "t1", name: "k" });
		await store.addNamespaceRoot("t1", "t1");

		// Erasing another tenant's scope is rejected; their data is untouched.
		const bad = await app.request("/scopes/delete", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({ scope: "t2/user/1" }),
		});
		expect(bad.status).toBe(400);
		expect(await memrez.store.getEntry("m_t2")).not.toBeNull();

		// Erasing within the tenant's root succeeds.
		const ok = await app.request("/scopes/delete", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({ scope: "t1/user/1" }),
		});
		expect(ok.status).toBe(200);
		expect(await memrez.store.getEntry("m_t1")).toBeNull();
		expect(await memrez.store.getEntry("m_t2")).not.toBeNull();
	});
});
