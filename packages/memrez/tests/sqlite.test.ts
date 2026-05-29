import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteMemoryStore, createMemrez } from "../src/index.js";

const tempDirs: string[] = [];

describe("SqliteMemoryStore", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists memory entries across store instances", async () => {
		const { dir, path } = tempDbPath();
		tempDirs.push(dir);

		const store = new SqliteMemoryStore(path);
		const memrez = createMemrez({ store });
		const write = await memrez.write(
			["app/user/u_123"],
			"Prefers email receipts.",
			{
				topicsHint: ["prefs"],
				source: { agentId: "support", runId: "run_1" },
			},
		);
		store.close();

		const reopened = new SqliteMemoryStore(path);
		const persisted = createMemrez({ store: reopened });
		const entries = await persisted.read(["app/user/u_123"], "prefs");

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			id: write.entry.id,
			scope: "app/user/u_123",
			content: "Prefers email receipts.",
			topics: ["prefs"],
			source: { agentId: "support", runId: "run_1" },
		});
		reopened.close();
	});

	it("scans ancestor scopes and excludes sibling scopes", async () => {
		const { dir, path } = tempDbPath();
		tempDirs.push(dir);
		const store = new SqliteMemoryStore(path);
		const memrez = createMemrez({ store });

		await memrez.write(["app"], "Global policy.", { topicsHint: ["shared"] });
		await memrez.write(["app/user/u_123"], "User 123 preference.", {
			topicsHint: ["prefs"],
		});
		await memrez.write(["app/user/u_456"], "User 456 preference.", {
			topicsHint: ["prefs"],
		});

		const scan = await memrez.scan(["app/user/u_123"]);
		const shared = await memrez.read(["app/user/u_123"], "shared");
		const prefs = await memrez.read(["app/user/u_123"], "prefs");

		expect(scan.topics.map((topic) => [topic.topic, topic.count])).toEqual([
			["prefs", 1],
			["shared", 1],
		]);
		expect(shared.map((entry) => entry.content)).toEqual(["Global policy."]);
		expect(prefs.map((entry) => entry.content)).toEqual([
			"User 123 preference.",
		]);
		store.close();
	});

	it("persists supersede state and topic metadata", async () => {
		const { dir, path } = tempDbPath();
		tempDirs.push(dir);
		const store = new SqliteMemoryStore(path);
		const now = new Date().toISOString();

		await store.putEntry({
			id: "mem_a",
			scope: "app/user/u_123",
			content: "Likes SMS.",
			topics: ["prefs"],
			type: "preference",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});
		await store.putEntry({
			id: "mem_b",
			scope: "app/user/u_123",
			content: "Prefers email.",
			topics: ["prefs"],
			type: "preference",
			status: "active",
			createdAt: now,
			updatedAt: now,
		});
		await store.supersede(["mem_a"], "mem_b");
		await store.setTopicMeta("app/user/u_123", "prefs", {
			blurb: "Communication preferences.",
			lastUpdatedAt: "2026-05-27T00:00:00.000Z",
		});

		const superseded = await store.getEntry("mem_a");
		const activeByTopic = await store.getByTopic(["app/user/u_123"], "prefs");
		const allPrefs = await store.listScopeSlice(["app/user/u_123"], {
			topics: ["prefs"],
			includeSuperseded: true,
		});
		const topics = await store.listTopics(["app/user/u_123"]);

		expect(superseded).toMatchObject({
			status: "superseded",
			supersededBy: "mem_b",
		});
		expect(activeByTopic.map((entry) => entry.id)).toEqual(["mem_b"]);
		expect(allPrefs.map((entry) => entry.id).sort()).toEqual([
			"mem_a",
			"mem_b",
		]);
		expect(topics).toEqual([
			{
				topic: "prefs",
				count: 1,
				blurb: "Communication preferences.",
				lastUpdatedAt: "2026-05-27T00:00:00.000Z",
				hasUncuratedWrites: true,
			},
		]);
		store.close();
	});
});

function tempDbPath(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "memrez-sqlite-"));
	return { dir, path: join(dir, "memrez.db") };
}
