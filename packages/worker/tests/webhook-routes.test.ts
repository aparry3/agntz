import {
	InMemoryRunRegistry,
	MemoryStore,
	_resetCryptoKeyCache,
} from "@agntz/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp(opts: { grace?: number } = {}) {
	const store = new MemoryStore();
	const runRegistry = new InMemoryRunRegistry({
		gracePeriodMs: opts.grace ?? 0,
		persistRun: async (run) => {
			if (run.userId) {
				await store
					.forUser(run.userId)
					.putRun(run)
					.catch(() => {});
			}
		},
	});
	const app = createWorkerAPI({
		store,
		internalSecret: SECRET,
		runRegistry,
		outboundUrlPolicy: { skipDnsResolution: true },
	});
	return { app, store, runRegistry };
}

function internalAuthHeaders() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
	} as const;
}

interface CreatedSecret {
	name: string;
	value: string;
	createdAt: string;
}

beforeEach(() => {
	process.env.AGNTZ_SECRET_KEY =
		"0000000000000000000000000000000000000000000000000000000000000001";
	_resetCryptoKeyCache();
});

describe("POST /webhook-secrets", () => {
	it("server-generates a secret and returns the raw value once", async () => {
		const { app } = makeApp();
		const res = await app.request("/webhook-secrets", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", name: "gymtext_prod" }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as CreatedSecret;
		expect(body.name).toBe("gymtext_prod");
		expect(body.value).toMatch(/^whsec_[0-9a-f]{64}$/);
		expect(body.createdAt).toBeTruthy();
	});

	it("400 when name is missing", async () => {
		const { app } = makeApp();
		const res = await app.request("/webhook-secrets", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1" }),
		});
		expect(res.status).toBe(400);
	});

	it("409 when name already exists", async () => {
		const { app } = makeApp();
		await app.request("/webhook-secrets", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", name: "gymtext_prod" }),
		});
		const res = await app.request("/webhook-secrets", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", name: "gymtext_prod" }),
		});
		expect(res.status).toBe(409);
	});
});

describe("GET /webhook-secrets", () => {
	it("lists secret metadata (no raw value) with bearer auth", async () => {
		const { app, store } = makeApp();
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const createRes = await app.request("/webhook-secrets", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", name: "gymtext_prod" }),
		});
		expect(createRes.status).toBe(201);

		const listRes = await app.request("/webhook-secrets", {
			method: "GET",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		expect(listRes.status).toBe(200);
		const rows = (await listRes.json()) as Array<Record<string, unknown>>;
		expect(rows.length).toBe(1);
		expect(rows[0]).toMatchObject({ name: "gymtext_prod" });
		expect(rows[0].lastFour).toBeTruthy();
		// Raw plaintext must never appear in list responses.
		expect(rows[0].value).toBeUndefined();
		expect(rows[0].secret).toBeUndefined();
	});
});

describe("POST /webhook-secrets/:name/regenerate", () => {
	it("upserts a new value in place and returns it once", async () => {
		const { app } = makeApp();
		const first = (await (
			await app.request("/webhook-secrets", {
				method: "POST",
				headers: internalAuthHeaders(),
				body: JSON.stringify({ userId: "u1", name: "gymtext_prod" }),
			})
		).json()) as CreatedSecret;

		const regenRes = await app.request(
			"/webhook-secrets/gymtext_prod/regenerate",
			{
				method: "POST",
				headers: internalAuthHeaders(),
				body: JSON.stringify({ userId: "u1" }),
			},
		);
		expect(regenRes.status).toBe(200);
		const second = (await regenRes.json()) as CreatedSecret;
		expect(second.name).toBe("gymtext_prod");
		expect(second.value).toMatch(/^whsec_[0-9a-f]{64}$/);
		expect(second.value).not.toBe(first.value);
	});

	it("404 when regenerating a non-existent name", async () => {
		const { app } = makeApp();
		const res = await app.request("/webhook-secrets/nope/regenerate", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1" }),
		});
		expect(res.status).toBe(404);
	});
});

describe("DELETE /webhook-secrets/:name", () => {
	it("204 and the secret is unresolvable afterwards", async () => {
		const { app, store } = makeApp();
		await app.request("/webhook-secrets", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", name: "gymtext_prod" }),
		});

		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const del = await app.request("/webhook-secrets/gymtext_prod", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		expect(del.status).toBe(204);

		const list = (await (
			await app.request("/webhook-secrets", {
				method: "GET",
				headers: { Authorization: `Bearer ${rawKey}` },
			})
		).json()) as Array<Record<string, unknown>>;
		expect(list.length).toBe(0);
	});
});

describe("POST /runs — webhook validation", () => {
	it("400 when callbackUrl is set without webhookSecretName", async () => {
		const { app } = makeApp();
		const res = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "any-agent",
				callbackUrl: "https://consumer.example/hook",
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/webhookSecretName/);
	});

	it("400 when webhookSecretName references a non-existent secret", async () => {
		const { app } = makeApp();
		const res = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "any-agent",
				callbackUrl: "https://consumer.example/hook",
				webhookSecretName: "gymtext_prod",
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/not found/);
	});

	it("starts a run when callbackUrl + valid webhookSecretName are provided", async () => {
		const { app, store } = makeApp();
		await store
			.forUser("u1")
			.putSecret({ name: "gymtext_prod", value: "whsec_test" });

		const res = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({
				userId: "u1",
				agentId: "missing-agent",
				callbackUrl: "https://consumer.example/hook",
				webhookSecretName: "gymtext_prod",
			}),
		});
		expect(res.status).toBe(201);
	});
});
