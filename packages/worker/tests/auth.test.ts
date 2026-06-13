import { createHmac } from "node:crypto";
import { MemoryStore } from "@agntz/core";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp() {
	const store = new MemoryStore();
	const app = createWorkerAPI({ store, internalSecret: SECRET });
	return { app, store };
}

function signedInternalAuth(claims: {
	actorUserId: string;
	tenantId: string;
	orgId?: string;
}): string {
	const now = Math.floor(Date.now() / 1000);
	const payload = Buffer.from(
		JSON.stringify({
			v: 1,
			roles: ["admin"],
			permissions: ["traces:read"],
			authMethod: "clerk",
			iat: now,
			exp: now + 60,
			...claims,
		}),
		"utf8",
	).toString("base64url");
	const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
	return `${payload}.${sig}`;
}

describe("workerAuth — X-User-Id header fallback", () => {
	it("signed internal tenant context resolves body-less GET scope", async () => {
		const { app, store } = makeApp();
		await store.forUser("org_1").upsertSummary({
			traceId: "tr_org",
			ownerId: "org_1",
			rootName: "manifest",
			agentId: "a1",
			startedAt: "2026-05-11T12:00:00.000Z",
			endedAt: "2026-05-11T12:00:01.000Z",
			durationMs: 1000,
			spanCount: 0,
			status: "ok",
			totalTokens: 0,
			totalCostUsd: null,
		});

		const res = await app.request("/traces", {
			method: "GET",
			headers: {
				"X-Internal-Secret": SECRET,
				"X-Agntz-Internal-Auth": signedInternalAuth({
					actorUserId: "user_1",
					tenantId: "org_1",
					orgId: "org_1",
				}),
			},
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { rows: Array<{ traceId: string }> };
		expect(body.rows.map((r) => r.traceId)).toEqual(["tr_org"]);
	});

	it("rejects invalid signed internal tenant context", async () => {
		const { app } = makeApp();
		const res = await app.request("/traces", {
			method: "GET",
			headers: {
				"X-Internal-Secret": SECRET,
				"X-Agntz-Internal-Auth": "bad.token",
			},
		});
		expect(res.status).toBe(401);
	});

	it("internal-secret + X-User-Id header resolves userId for body-less GET", async () => {
		const { app, store } = makeApp();
		await store.forUser("u1").upsertSummary({
			traceId: "tr_a",
			ownerId: "u1",
			rootName: "manifest",
			agentId: "a1",
			startedAt: "2026-05-11T12:00:00.000Z",
			endedAt: "2026-05-11T12:00:01.000Z",
			durationMs: 1000,
			spanCount: 0,
			status: "ok",
			totalTokens: 0,
			totalCostUsd: null,
		});

		const res = await app.request("/traces", {
			method: "GET",
			headers: {
				"X-Internal-Secret": SECRET,
				"X-User-Id": "u1",
			},
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { rows: Array<{ traceId: string }> };
		expect(body.rows.map((r) => r.traceId)).toEqual(["tr_a"]);
	});

	it("body userId takes precedence over X-User-Id header", async () => {
		const { app, store } = makeApp();
		await store.forUser("u1").upsertSummary({
			traceId: "tr_u1",
			ownerId: "u1",
			rootName: "manifest",
			agentId: "a1",
			startedAt: "2026-05-11T12:00:00.000Z",
			endedAt: "2026-05-11T12:00:01.000Z",
			durationMs: 1000,
			spanCount: 0,
			status: "ok",
			totalTokens: 0,
			totalCostUsd: null,
		});
		await store.forUser("u2").upsertSummary({
			traceId: "tr_u2",
			ownerId: "u2",
			rootName: "manifest",
			agentId: "a1",
			startedAt: "2026-05-11T12:00:00.000Z",
			endedAt: "2026-05-11T12:00:01.000Z",
			durationMs: 1000,
			spanCount: 0,
			status: "ok",
			totalTokens: 0,
			totalCostUsd: null,
		});

		// POST /runs uses internal-secret auth with a body. Header says u2 but
		// body says u1 — body wins, so the run belongs to u1.
		const res = await app.request("/runs", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Internal-Secret": SECRET,
				"X-User-Id": "u2",
			},
			body: JSON.stringify({ userId: "u1", agentId: "missing-agent" }),
		});
		expect(res.status).toBe(201);
		const run = (await res.json()) as { userId?: string };
		expect(run.userId).toBe("u1");
	});

	it("400 when internal-secret is provided but neither header nor body has userId", async () => {
		const { app } = makeApp();
		const res = await app.request("/traces", {
			method: "GET",
			headers: { "X-Internal-Secret": SECRET },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/userId/);
	});
});
