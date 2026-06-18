import { createMemrez } from "@agntz/memrez";
import { PlatformMemoryStore as MemoryStore } from "@agntz/platform/memory";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

// End-to-end of the canonical "delete an end-user" flow. A customer (gymtext) is
// ONE agntz tenant; its end-users are namespaces within that tenant. Erasing
// end-user 123 means composing the two axis-pure primitives: deleteScope
// (namespace axis → memories) + deleteSession (tenant axis → conversations).
const SECRET = "test-secret";
const TENANT = "gymtext_tenant";

function tenantHeaders() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
		"X-User-Id": TENANT,
	} as const;
}

describe("delete end-user (scope + session composition)", () => {
	it("erases an end-user's memories and sessions, leaving siblings intact", async () => {
		const store = new MemoryStore();
		const memrez = createMemrez();
		const now = new Date().toISOString();

		// gymtext (the tenant) owns the "gymtext" namespace root.
		await store.addNamespaceRoot(TENANT, "gymtext");

		// Namespace axis: end-user 123 + a sibling end-user 124.
		await memrez.store.putEntry({
			id: "m123",
			scope: "gymtext/user/123",
			content: "User 123 fact.",
			topics: ["t"],
			type: "fact",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});
		await memrez.store.putEntry({
			id: "m124",
			scope: "gymtext/user/124",
			content: "User 124 fact.",
			topics: ["t"],
			type: "fact",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});

		// Tenant axis: sessions live under the tenant; gymtext tracks which
		// session belongs to which end-user.
		const scoped = store.forUser(TENANT);
		await scoped.getOrCreateSession("sess-123");
		await scoped.append("sess-123", [
			{ role: "user", content: "hi 123", timestamp: now },
		]);
		await scoped.getOrCreateSession("sess-124");

		const app = createWorkerAPI({
			store,
			internalSecret: SECRET,
			memrez,
			resources: { memory: memrez.provider() },
		});

		// The application composes the two primitives to erase end-user 123.
		// The scope is bounded to the tenant's registered "gymtext" root.
		const scopeRes = await app.request("/scopes/delete", {
			method: "POST",
			headers: tenantHeaders(),
			body: JSON.stringify({ scope: "gymtext/user/123" }),
		});
		expect(scopeRes.status).toBe(200);
		expect((await scopeRes.json()).total).toBe(1);

		const sessRes = await app.request("/sessions/sess-123", {
			method: "DELETE",
			headers: tenantHeaders(),
		});
		expect(sessRes.status).toBe(204);

		// End-user 123 fully erased across both axes.
		expect(await memrez.store.getEntry("m123")).toBeNull();
		expect(await scoped.getMessages("sess-123")).toEqual([]);

		// Sibling end-user 124 untouched.
		expect(await memrez.store.getEntry("m124")).not.toBeNull();
		expect((await scoped.listSessions()).map((s) => s.sessionId)).toEqual([
			"sess-124",
		]);
	});
});
