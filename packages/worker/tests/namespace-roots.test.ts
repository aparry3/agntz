import { MemoryStore } from "@agntz/core";
import { createMemrez } from "@agntz/memrez";
import type {
	CurateOp,
	MemrezReasoner,
	TaggerInput,
	TaggerResult,
} from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { signInternalAuthToken } from "../src/middleware/internal-auth.js";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

/** Curator that tries to supersede every entry it is shown (attacker-style). */
class SupersedeAllReasoner implements MemrezReasoner {
	async tag(input: TaggerInput): Promise<TaggerResult> {
		return {
			namespace: input.grants[0],
			topics: ["t"],
			type: "fact",
			normalizedContent: input.content.trim(),
		};
	}

	async curate(input: { entries: { id: string }[] }): Promise<CurateOp[]> {
		return input.entries.map((e) => ({
			type: "supersede",
			ids: [e.id],
			replacement: { namespace: "acme/team", content: "x", topics: ["t"] },
		}));
	}
}

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

	// Regression: a tenant rooted at a NESTED namespace must not read entries at
	// the parent scope via memrez's default ancestor expansion.
	it("does not leak ancestor scopes above a nested root on reads", async () => {
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
		await put("m_parent", "acme"); // ABOVE the root — must stay hidden
		await put("m_team", "acme/team/1"); // within the root
		const app = createWorkerAPI({
			store,
			internalSecret: SECRET,
			memrez,
			resources: { memory: memrez.provider() },
		});
		const { rawKey } = await store.createApiKey({
			userId: "acme-t",
			name: "k",
		});
		await store.addNamespaceRoot("acme-t", "acme/team");

		const res = await app.request("/memory/entries?grants=acme/team/1", {
			headers: bearer(rawKey),
		});
		expect(res.status).toBe(200);
		const got = (
			(await res.json()) as { entries: { id: string }[] }
		).entries.map((e) => e.id);
		expect(got).toEqual(["m_team"]); // m_parent@acme NOT leaked
	});

	it("bounds /memory/import writes to the tenant's roots", async () => {
		const { store, memrez, app } = await setup();
		const { rawKey } = await store.createApiKey({ userId: "t1", name: "k" });
		await store.addNamespaceRoot("t1", "t1");

		const ts = new Date().toISOString();
		const base = {
			id: "imp_1",
			content: "x",
			topics: ["t"],
			type: "fact",
			status: "active",
			createdAt: ts,
			updatedAt: ts,
		};

		// Importing into another tenant's namespace is rejected; nothing is written.
		const bad = await app.request("/memory/import", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({ entries: [{ ...base, scope: "t2/user/9" }] }),
		});
		expect(bad.status).toBe(400);
		expect(await memrez.store.getEntry("imp_1")).toBeNull();

		// Importing within the tenant's root succeeds.
		const ok = await app.request("/memory/import", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({ entries: [{ ...base, scope: "t1/user/9" }] }),
		});
		expect(ok.status).toBe(200);
		expect(await memrez.store.getEntry("imp_1")).not.toBeNull();

		// A tenant cannot overwrite (by id) an entry whose existing scope is outside
		// its roots, even if the new scope is within them.
		const clobber = await app.request("/memory/import", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({
				entries: [{ ...base, id: "m_t2", scope: "t1/x" }],
			}),
		});
		expect(clobber.status).toBe(400);
		expect((await memrez.store.getEntry("m_t2"))?.scope).toBe("t2/user/1");
	});

	// Regression: bounded curate must not expand to ancestor scopes (read OR
	// supersede entries above the tenant's root).
	it("does not curate/supersede ancestor scopes above a nested root", async () => {
		const store = new MemoryStore();
		const memrez = createMemrez({ reasoner: new SupersedeAllReasoner() });
		const now = new Date().toISOString();
		await memrez.store.putEntry({
			id: "m_parent",
			scope: "acme", // ABOVE the tenant root
			content: "p",
			topics: ["t"],
			type: "fact",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});
		const app = createWorkerAPI({
			store,
			internalSecret: SECRET,
			memrez,
			resources: { memory: memrez.provider() },
		});
		const { rawKey } = await store.createApiKey({
			userId: "acme-t",
			name: "k",
		});
		await store.addNamespaceRoot("acme-t", "acme/team");

		const res = await app.request("/memory/curate", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({ grants: ["acme/team"] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			report: { scanned: number; superseded: number };
		};
		expect(body.report.scanned).toBe(0); // ancestor 'acme' entry NOT scanned
		expect((await memrez.store.getEntry("m_parent"))?.status).toBe("active");
	});

	it("rejects import from a tenant with no registered roots (403)", async () => {
		const { app, store } = await setup();
		const { rawKey } = await store.createApiKey({ userId: "t9", name: "k" });
		const res = await app.request("/memory/import", {
			method: "POST",
			headers: bearer(rawKey),
			body: JSON.stringify({
				entries: [
					{
						id: "x",
						scope: "t9/a",
						content: "x",
						topics: ["t"],
						type: "fact",
						status: "active",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
				],
			}),
		});
		expect(res.status).toBe(403);
	});
});
