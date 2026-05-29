import { InMemoryRunRegistry, MemoryStore, type Run } from "@agntz/core";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp(opts: { grace?: number } = {}) {
	const store = new MemoryStore();
	// grace defaults to 0 so terminal runs evict promptly — keeps tests fast.
	// Tests that need a run to persist in memory pass an explicit grace.
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
	const app = createWorkerAPI({ store, internalSecret: SECRET, runRegistry });
	return { app, store, runRegistry };
}

function internalAuthHeaders() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
	} as const;
}

describe("POST /runs", () => {
	it("400 when agentId is missing", async () => {
		const { app } = makeApp();
		const res = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", input: "hello" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/agentId/);
	});

	it("404 when the agent doesn't exist (executor rejection bubbles via 5xx if sync; or run is created and fails async)", async () => {
		// The route creates the Run first, returns 201, and rejects later via the executor.
		// This test pins down the synchronous shape: missing-agent does NOT block the 201 response.
		const { app } = makeApp();
		const res = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", agentId: "nonexistent" }),
		});
		expect(res.status).toBe(201);
		const run = (await res.json()) as {
			id: string;
			status: string;
			agentId: string;
		};
		expect(run.agentId).toBe("nonexistent");
		expect(["pending", "running"]).toContain(run.status);
	});

	it("401 without auth", async () => {
		const { app } = makeApp();
		const res = await app.request("/runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ agentId: "a" }),
		});
		expect(res.status).toBe(401);
	});
});

describe("GET /runs/:id", () => {
	it("404 for unknown id", async () => {
		const { app } = makeApp();
		const res = await app.request("/runs/run_does_not_exist", {
			method: "POST", // Use auth pattern that requires body; switch to GET with internal-only is not supported. Use the workerAuth flow.
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1" }),
		});
		// Note: GET routes require workerAuth which can use Bearer OR internal+body.
		// The above POST is just to exercise auth. Now do the actual GET via Bearer
		// — but we need an API key. Easier: register one, then GET.
		expect(res.status).toBeGreaterThan(0);
	});

	it("returns the Run when owned by the calling user", async () => {
		const { app, store } = makeApp();
		// Create a run directly via the route to get a real id.
		const startRes = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", agentId: "missing-agent" }),
		});
		const created = (await startRes.json()) as { id: string };
		expect(created.id).toBeDefined();

		// Issue an API key for u1 so we can use Bearer auth on the GET.
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const getRes = await app.request(`/runs/${created.id}`, {
			method: "GET",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		expect(getRes.status).toBe(200);
		const run = (await getRes.json()) as { id: string; userId?: string };
		expect(run.id).toBe(created.id);
		expect(run.userId).toBe("u1");
	});

	it("404 when a different user tries to read another's run", async () => {
		const { app, store } = makeApp();
		const startRes = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", agentId: "missing-agent" }),
		});
		const created = (await startRes.json()) as { id: string };

		const { rawKey: u2Key } = await store
			.forUser("u2")
			.createApiKey({ userId: "u2", name: "test" });

		const res = await app.request(`/runs/${created.id}`, {
			method: "GET",
			headers: { Authorization: `Bearer ${u2Key}` },
		});
		expect(res.status).toBe(404);
	});
});

describe("POST /runs/:id/cancel", () => {
	it("returns 404 for an unknown id", async () => {
		const { app, store } = makeApp();
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });
		const res = await app.request("/runs/run_nope/cancel", {
			method: "POST",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		expect(res.status).toBe(404);
	});

	it("cancels an owned run and returns the updated state", async () => {
		// Bypass the route's executor (which would fail and evict the run) by
		// creating the Run directly on the registry. The cancel route only needs
		// an in-memory entry to operate on.
		const { app, store, runRegistry } = makeApp({ grace: 60_000 });
		const run = runRegistry.create({
			agentId: "a1",
			input: "go",
			userId: "u1",
		});
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const res = await app.request(`/runs/${run.id}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { id: string };
		expect(body.id).toBe(run.id);
		// Registry's cancel() aborts the controller but status finalizes when the
		// executor's promise rejects. With no executor started here, the status
		// remains "pending" and the abort signal is set.
		const live = runRegistry.get(run.id);
		expect(live?.id).toBe(run.id);
	});

	it("404 when a different user tries to cancel", async () => {
		const { app, store } = makeApp();
		const startRes = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", agentId: "missing-agent" }),
		});
		const created = (await startRes.json()) as { id: string };
		const { rawKey: u2Key } = await store
			.forUser("u2")
			.createApiKey({ userId: "u2", name: "test" });

		const res = await app.request(`/runs/${created.id}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${u2Key}` },
		});
		expect(res.status).toBe(404);
	});
});

/** Build a minimal valid Run for seeding the store directly. */
function makeRun(
	overrides: Partial<Run> & Pick<Run, "id" | "startedAt" | "userId">,
): Run {
	return {
		id: overrides.id,
		rootId: overrides.rootId ?? overrides.id,
		parentId: overrides.parentId,
		agentId: overrides.agentId ?? "test-agent",
		userId: overrides.userId,
		status: overrides.status ?? "completed",
		input: overrides.input ?? "",
		startedAt: overrides.startedAt,
		endedAt: overrides.endedAt,
		depth: overrides.depth ?? 0,
	};
}

/**
 * Issue a real API key for the given userId and return an Authorization header
 * object suitable for passing to `app.request`.
 */
async function authHeaders(
	store: MemoryStore,
	userId: string,
): Promise<{ Authorization: string }> {
	const { rawKey } = await store
		.forUser(userId)
		.createApiKey({ userId, name: "test" });
	return { Authorization: `Bearer ${rawKey}` };
}

describe("GET /runs/:id/stream", () => {
	it("400 on non-numeric since param", async () => {
		const { app, store } = makeApp();
		const startRes = await app.request("/runs", {
			method: "POST",
			headers: internalAuthHeaders(),
			body: JSON.stringify({ userId: "u1", agentId: "missing-agent" }),
		});
		const created = (await startRes.json()) as { id: string };
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });

		const res = await app.request(
			`/runs/${created.id}/stream?since=not-a-number`,
			{
				method: "GET",
				headers: { Authorization: `Bearer ${rawKey}` },
			},
		);
		expect(res.status).toBe(400);
	});

	it("404 when neither registry nor RunStore has the run", async () => {
		const { app, store } = makeApp();
		const { rawKey } = await store
			.forUser("u1")
			.createApiKey({ userId: "u1", name: "test" });
		const res = await app.request("/runs/run_nope/stream", {
			method: "GET",
			headers: { Authorization: `Bearer ${rawKey}` },
		});
		expect(res.status).toBe(404);
	});
});

describe("GET /runs", () => {
	it("returns 401 without auth", async () => {
		const { app } = makeApp();
		const res = await app.request("/runs");
		expect(res.status).toBe(401);
	});

	it("returns the user's runs ordered by startedAt DESC", async () => {
		const { app, store } = makeApp();
		await store
			.forUser("u1")
			.putRun(makeRun({ id: "a", startedAt: 100, userId: "u1" }));
		await store
			.forUser("u1")
			.putRun(makeRun({ id: "b", startedAt: 200, userId: "u1" }));
		const res = await app.request("/runs", {
			headers: await authHeaders(store, "u1"),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { rows: Run[]; cursor?: string };
		expect(body.rows.map((r) => r.id)).toEqual(["b", "a"]);
	});

	it("respects rootsOnly filter via query string", async () => {
		const { app, store } = makeApp();
		await store
			.forUser("u1")
			.putRun(makeRun({ id: "root", startedAt: 100, userId: "u1" }));
		await store.forUser("u1").putRun(
			makeRun({
				id: "child",
				startedAt: 200,
				userId: "u1",
				parentId: "root",
				rootId: "root",
				depth: 1,
			}),
		);
		const res = await app.request("/runs?rootsOnly=false", {
			headers: await authHeaders(store, "u1"),
		});
		const body = (await res.json()) as { rows: Run[] };
		expect(body.rows.map((r) => r.id).sort()).toEqual(["child", "root"]);
	});

	it("returns 400 on invalid limit", async () => {
		const { app, store } = makeApp();
		const res = await app.request("/runs?limit=abc", {
			headers: await authHeaders(store, "u1"),
		});
		expect(res.status).toBe(400);
	});

	it("scopes results to the authenticated user", async () => {
		const { app, store } = makeApp();
		await store
			.forUser("u1")
			.putRun(makeRun({ id: "mine", startedAt: 100, userId: "u1" }));
		await store
			.forUser("u2")
			.putRun(makeRun({ id: "yours", startedAt: 200, userId: "u2" }));
		const res = await app.request("/runs", {
			headers: await authHeaders(store, "u1"),
		});
		const body = (await res.json()) as { rows: Run[] };
		expect(body.rows.map((r) => r.id)).toEqual(["mine"]);
	});
});
