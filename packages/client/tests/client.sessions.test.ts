import { describe, expect, it } from "vitest";
import { AgntzClient, type SessionSummary } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

function sampleSummary(
	overrides: Partial<SessionSummary> = {},
): SessionSummary {
	return {
		sessionId: "s1",
		agentId: "a1",
		messageCount: 2,
		createdAt: "2026-05-11T12:00:00.000Z",
		updatedAt: "2026-05-11T12:00:01.000Z",
		...overrides,
	};
}

describe("AgntzClient.sessions.list", () => {
	it("GET /sessions, unwraps { sessions }, sends Bearer", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, { sessions: [sampleSummary()] }),
		);
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const out = await client.sessions.list({ agentId: "a1" });
		expect(out).toHaveLength(1);
		expect(out[0].sessionId).toBe("s1");
		expect(mock.calls[0]?.url).toBe(`${BASE}/sessions?agentId=a1`);
		expect(
			(mock.calls[0]?.init.headers as Record<string, string>).Authorization,
		).toBe("Bearer k");
	});

	it("omits query string when no filter is given", async () => {
		const mock = mockFetch(() => jsonResponse(200, { sessions: [] }));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		await client.sessions.list();
		expect(mock.calls[0]?.url).toBe(`${BASE}/sessions`);
	});
});

describe("AgntzClient.sessions.get / delete", () => {
	it("GET /sessions/:id returns { sessionId, messages }", async () => {
		const detail = { sessionId: "s1", messages: [] };
		const mock = mockFetch(() => jsonResponse(200, detail));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		const out = await client.sessions.get("s1");
		expect(out).toEqual(detail);
		expect(mock.calls[0]?.url).toBe(`${BASE}/sessions/s1`);
	});

	it("DELETE /sessions/:id resolves on 204 and URL-encodes the id", async () => {
		const mock = mockFetch(() => new Response(null, { status: 204 }));
		const client = new AgntzClient({
			apiKey: "k",
			baseUrl: BASE,
			fetch: mock.fetch,
		});
		await client.sessions.delete("s/has slash");
		expect(mock.calls[0]?.url).toBe(`${BASE}/sessions/s%2Fhas%20slash`);
		expect(mock.calls[0]?.init.method).toBe("DELETE");
	});
});
