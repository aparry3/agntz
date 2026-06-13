import { MemoryStore } from "@agntz/core";
import { DeterministicReasoner, createMemrez } from "@agntz/memrez";
import type {
	CurateOp,
	MemoryEntry,
	MemrezReasoner,
	TaggerInput,
	TaggerResult,
} from "@agntz/memrez";
import { describe, expect, it } from "vitest";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

class FakeReasoner implements MemrezReasoner {
	public nextCurateOps: CurateOp[] = [];
	public curateCalls: Array<{
		grants: string[];
		scopePaths?: string[];
		topics?: string[];
		entries?: string[];
	}> = [];

	async tag(input: TaggerInput): Promise<TaggerResult> {
		return {
			namespace: input.grants[0],
			topics: input.topicsHint?.length ? input.topicsHint : ["general"],
			type: "fact",
			normalizedContent: input.content.trim(),
		};
	}

	async curate(input: {
		grants: string[];
		scopePaths?: string[];
		entries?: MemoryEntry[];
		topics?: string[];
	}): Promise<CurateOp[]> {
		this.curateCalls.push({
			grants: input.grants,
			scopePaths: input.scopePaths,
			topics: input.topics,
			entries: input.entries?.map((entry) => entry.scope),
		});
		return this.nextCurateOps;
	}
}

function makeApp(memrez?: ReturnType<typeof createMemrez>) {
	return createWorkerAPI({
		store: new MemoryStore(),
		internalSecret: SECRET,
		memrez,
	});
}

function headers() {
	return {
		"Content-Type": "application/json",
		"X-Internal-Secret": SECRET,
	} as const;
}

describe("worker memory routes", () => {
	it("rejects requests without the internal secret", async () => {
		const app = makeApp(createMemrez());
		const res = await app.request("/memory/topics?grants=app/user/u_1");
		expect(res.status).toBe(401);
	});

	it("returns 503 when memrez is not configured", async () => {
		const app = makeApp(undefined);
		const res = await app.request("/memory/topics?grants=app/user/u_1", {
			headers: headers(),
		});
		expect(res.status).toBe(503);
	});

	it("scans topics for the given grants", async () => {
		const memrez = createMemrez({ reasoner: new FakeReasoner() });
		await memrez.write(["app/user/u_1"], "Prefers email.", {
			topicsHint: ["prefs"],
		});
		await memrez.write(["app/user/u_2"], "Sibling fact.", {
			topicsHint: ["prefs"],
		});
		const app = makeApp(memrez);

		const res = await app.request("/memory/topics?grants=app/user/u_1", {
			headers: headers(),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			grants: string[];
			topics: Array<{ topic: string; count: number }>;
		};
		expect(body.grants).toEqual(["app/user/u_1"]);
		expect(body.topics).toHaveLength(1);
		expect(body.topics[0]).toMatchObject({ topic: "prefs", count: 1 });
	});

	it("rejects reads without grants or with malformed grants", async () => {
		const app = makeApp(createMemrez());
		const missing = await app.request("/memory/entries", {
			headers: headers(),
		});
		const malformed = await app.request("/memory/entries?grants=/bad/", {
			headers: headers(),
		});
		expect(missing.status).toBe(400);
		expect(malformed.status).toBe(400);
	});

	it("lists entries with topic filter, audit view, and pagination", async () => {
		const memrez = createMemrez({ reasoner: new FakeReasoner() });
		const first = await memrez.write(["app/user/u_1"], "Old preference.", {
			topicsHint: ["prefs"],
		});
		await memrez.write(["app/user/u_1"], "Has dumbbells.", {
			topicsHint: ["equipment"],
		});
		await memrez.correct(["app/user/u_1"], first.entry.id, "New preference.");
		const app = makeApp(memrez);

		const active = await app.request("/memory/entries?grants=app/user/u_1", {
			headers: headers(),
		});
		const activeBody = (await active.json()) as {
			entries: MemoryEntry[];
			total: number;
		};
		expect(active.status).toBe(200);
		expect(activeBody.total).toBe(2);
		expect(activeBody.entries.map((entry) => entry.content).sort()).toEqual([
			"Has dumbbells.",
			"New preference.",
		]);

		const audit = await app.request(
			"/memory/entries?grants=app/user/u_1&includeSuperseded=true&topics=prefs",
			{ headers: headers() },
		);
		const auditBody = (await audit.json()) as {
			entries: MemoryEntry[];
			total: number;
		};
		expect(auditBody.total).toBe(2);
		expect(
			auditBody.entries.find((entry) => entry.id === first.entry.id),
		).toMatchObject({ status: "superseded" });

		const page = await app.request(
			"/memory/entries?grants=app/user/u_1&limit=1&offset=1",
			{ headers: headers() },
		);
		const pageBody = (await page.json()) as {
			entries: MemoryEntry[];
			total: number;
			limit: number;
			offset: number;
		};
		expect(pageBody.total).toBe(2);
		expect(pageBody.entries).toHaveLength(1);
		expect(pageBody).toMatchObject({ limit: 1, offset: 1 });
	});

	it("corrects an entry and maps not-found and conflict errors", async () => {
		const memrez = createMemrez({ reasoner: new FakeReasoner() });
		const original = await memrez.write(["app/user/u_1"], "Old.", {
			topicsHint: ["prefs"],
		});
		const app = makeApp(memrez);

		const ok = await app.request(
			`/memory/entries/${original.entry.id}/correct`,
			{
				method: "POST",
				headers: headers(),
				body: JSON.stringify({ grants: ["app/user/u_1"], content: "New." }),
			},
		);
		expect(ok.status).toBe(200);
		const okBody = (await ok.json()) as { entry: MemoryEntry };
		expect(okBody.entry).toMatchObject({
			content: "New.",
			topics: ["prefs"],
			scope: "app/user/u_1",
		});

		const missing = await app.request("/memory/entries/mem_missing/correct", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ grants: ["app/user/u_1"], content: "X." }),
		});
		expect(missing.status).toBe(404);

		const conflict = await app.request(
			`/memory/entries/${original.entry.id}/correct`,
			{
				method: "POST",
				headers: headers(),
				body: JSON.stringify({ grants: ["app/user/u_1"], content: "Again." }),
			},
		);
		expect(conflict.status).toBe(409);

		const badScope = await app.request(
			`/memory/entries/${okBody.entry.id}/correct`,
			{
				method: "POST",
				headers: headers(),
				body: JSON.stringify({ grants: ["app/user/u_2"], content: "Steal." }),
			},
		);
		expect(badScope.status).toBe(400);
	});

	it("curates explicit grants and reports", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });
		await memrez.write(["app/user/u_1"], "Fact.", { topicsHint: ["prefs"] });
		const app = makeApp(memrez);

		const res = await app.request("/memory/curate", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ grants: ["app/user/u_1"] }),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			curateEnabled: boolean;
			report: { scanned: number };
		};
		expect(body.curateEnabled).toBe(true);
		expect(body.report.scanned).toBe(1);
	});

	it("sweeps dirty topics per scope when no grants are given", async () => {
		const reasoner = new FakeReasoner();
		const memrez = createMemrez({ reasoner });
		await memrez.write(["app"], "Global shared rule.", {
			topicsHint: ["shared"],
		});
		await memrez.write(["app/user/u_1"], "Prefers email.", {
			topicsHint: ["prefs"],
		});
		await memrez.write(["app/user/u_2"], "Wants strength.", {
			topicsHint: ["goals"],
		});
		const app = makeApp(memrez);

		const res = await app.request("/memory/curate", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			curateEnabled: boolean;
			dirty: number;
			scopes: Array<{ scope: string; topics: string[] }>;
		};
		expect(body.curateEnabled).toBe(true);
		expect(body.dirty).toBe(3);
		expect(body.scopes.map((scope) => scope.scope).sort()).toEqual([
			"app",
			"app/user/u_1",
			"app/user/u_2",
		]);
		expect(reasoner.curateCalls.map((call) => call.grants)).toEqual([
			["app"],
			["app/user/u_1"],
			["app/user/u_2"],
		]);
		expect(reasoner.curateCalls).toEqual([
			expect.objectContaining({ scopePaths: ["app"], entries: ["app"] }),
			expect.objectContaining({
				scopePaths: ["app/user/u_1"],
				entries: ["app/user/u_1"],
			}),
			expect.objectContaining({
				scopePaths: ["app/user/u_2"],
				entries: ["app/user/u_2"],
			}),
		]);

		// Sweep stamped both scopes — a second sweep finds nothing dirty.
		const again = await app.request("/memory/curate", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({}),
		});
		expect(((await again.json()) as { dirty: number }).dirty).toBe(0);
	});

	it("reports curation as disabled when the reasoner cannot curate", async () => {
		// The deterministic kill-switch (MEMREZ_REASONER=deterministic) has no
		// curate implementation — the sweep must say so instead of no-opping.
		const memrez = createMemrez({ reasoner: new DeterministicReasoner() });
		await memrez.write(["app/user/u_1"], "Fact.", { topicsHint: ["prefs"] });
		const app = makeApp(memrez);

		const res = await app.request("/memory/curate", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ curateEnabled: false });
	});
});
