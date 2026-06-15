import { describe, expect, it } from "vitest";
import { AgntzClient, type MemoryEntry } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

function entry(id: string): MemoryEntry {
	return {
		id,
		scope: "gymtext/user/1",
		content: "x",
		topics: ["prefs"],
		type: "fact",
		status: "active",
		createdAt: "2026-05-11T12:00:00.000Z",
		updatedAt: "2026-05-11T12:00:00.000Z",
	};
}

function client(mock: ReturnType<typeof mockFetch>) {
	return new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
}

describe("AgntzClient.memory reads", () => {
	it("scan → GET /memory/topics with grants + Bearer", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, { grants: ["gymtext"], topics: [] }),
		);
		const out = await client(mock).memory.scan(["gymtext"]);
		expect(out.grants).toEqual(["gymtext"]);
		expect(mock.calls[0]?.url).toBe(`${BASE}/memory/topics?grants=gymtext`);
		expect(
			(mock.calls[0]?.init.headers as Record<string, string>).Authorization,
		).toBe("Bearer k");
	});

	it("list → GET /memory/entries, unwraps entries[]", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, {
				entries: [entry("m1")],
				total: 1,
				limit: 200,
				offset: 0,
			}),
		);
		const out = await client(mock).memory.list(["gymtext"], {
			includeSuperseded: true,
			limit: 10,
		});
		expect(out.map((e) => e.id)).toEqual(["m1"]);
		const url = mock.calls[0]?.url ?? "";
		expect(url).toContain(`${BASE}/memory/entries?`);
		expect(url).toContain("grants=gymtext");
		expect(url).toContain("includeSuperseded=true");
		expect(url).toContain("limit=10");
	});

	it("read → GET /memory/entries?topics=, unwraps entries[]", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, {
				entries: [entry("m1")],
				total: 1,
				limit: 200,
				offset: 0,
			}),
		);
		await client(mock).memory.read(["gymtext"], ["prefs", "goals"]);
		expect(mock.calls[0]?.url).toContain("topics=prefs%2Cgoals");
	});
});

describe("AgntzClient.memory writes/deletes", () => {
	it("deleteEntry → DELETE /memory/entries/:id?grants=", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, { deleted: true, id: "m1" }),
		);
		const out = await client(mock).memory.deleteEntry(["gymtext"], "m1");
		expect(out).toEqual({ deleted: true, id: "m1" });
		expect(mock.calls[0]?.init.method).toBe("DELETE");
		expect(mock.calls[0]?.url).toBe(`${BASE}/memory/entries/m1?grants=gymtext`);
	});

	it("correct → POST /memory/entries/:id/correct with grants+content", async () => {
		const mock = mockFetch(() => jsonResponse(200, { entry: entry("m2") }));
		const out = await client(mock).memory.correct(["gymtext"], "m1", "new");
		expect(out.entry.id).toBe("m2");
		expect(mock.calls[0]?.url).toBe(`${BASE}/memory/entries/m1/correct`);
		expect(mock.calls[0]?.init.method).toBe("POST");
		expect(JSON.parse(String(mock.calls[0]?.init.body))).toEqual({
			grants: ["gymtext"],
			content: "new",
		});
	});

	it("deleteScope → POST /scopes/delete { scope }", async () => {
		const mock = mockFetch(() =>
			jsonResponse(200, {
				scope: "gymtext/user/1",
				recursive: true,
				total: 3,
				byResource: { memory: 3 },
			}),
		);
		const out = await client(mock).memory.deleteScope(
			["gymtext"],
			"gymtext/user/1",
			{ recursive: true },
		);
		expect(out.total).toBe(3);
		expect(mock.calls[0]?.url).toBe(`${BASE}/scopes/delete`);
		expect(JSON.parse(String(mock.calls[0]?.init.body))).toMatchObject({
			scope: "gymtext/user/1",
			recursive: true,
		});
	});
});
