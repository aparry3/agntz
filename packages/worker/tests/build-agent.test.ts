import { MemoryStore } from "@agntz/core";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp() {
	const store = new MemoryStore();
	const app = createWorkerAPI({ store, internalSecret: SECRET });
	return { app };
}

describe("POST /build-agent", () => {
	it("requires no auth headers", async () => {
		const { app } = makeApp();
		// Body intentionally missing the required field so the route can return
		// 400 without spending an LLM token — confirms the rate-limit middleware
		// and validation run BEFORE auth (since there's no auth on this route).
		const res = await app.request("/build-agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/description/i);
	});

	it("rejects non-string description", async () => {
		const { app } = makeApp();
		const res = await app.request("/build-agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ description: 123 }),
		});
		expect(res.status).toBe(400);
	});

	it("rejects descriptions over the size cap", async () => {
		const { app } = makeApp();
		const oversize = "a".repeat(5000);
		const res = await app.request("/build-agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ description: oversize }),
		});
		expect(res.status).toBe(413);
		const body = (await res.json()) as { error: string };
		expect(body.error).toMatch(/max length/i);
	});

	it("rejects non-string currentManifest", async () => {
		const { app } = makeApp();
		const res = await app.request("/build-agent", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ description: "ok", currentManifest: 5 }),
		});
		expect(res.status).toBe(400);
	});

	it("rate-limits after the 11th request from the same IP within the window", async () => {
		const { app } = makeApp();
		// Send 10 invalid requests (cheap — 400s) so we never invoke the
		// agent-builder pipeline, then assert the 11th gets a 429. The rate
		// limiter runs before validation, so 400s consume the bucket.
		const headers = {
			"content-type": "application/json",
			"x-forwarded-for": "203.0.113.42",
		};
		for (let i = 0; i < 10; i++) {
			const res = await app.request("/build-agent", {
				method: "POST",
				headers,
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(400);
		}
		const blocked = await app.request("/build-agent", {
			method: "POST",
			headers,
			body: JSON.stringify({ description: "anything" }),
		});
		expect(blocked.status).toBe(429);
		const body = (await blocked.json()) as { retryAfterSeconds: number };
		expect(blocked.headers.get("retry-after")).toBeTruthy();
		expect(body.retryAfterSeconds).toBeGreaterThan(0);
	});

	it("keeps separate buckets per client IP", async () => {
		const { app } = makeApp();
		// Burn the bucket for IP A...
		for (let i = 0; i < 10; i++) {
			await app.request("/build-agent", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-forwarded-for": "198.51.100.1",
				},
				body: JSON.stringify({}),
			});
		}
		const ipABlocked = await app.request("/build-agent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": "198.51.100.1",
			},
			body: JSON.stringify({}),
		});
		expect(ipABlocked.status).toBe(429);
		// ...IP B should still be allowed.
		const ipBOk = await app.request("/build-agent", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": "198.51.100.2",
			},
			body: JSON.stringify({}),
		});
		expect(ipBOk.status).toBe(400);
	});
});
