import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DeterministicReasoner,
	SqliteMemoryStore,
	createMemrez,
} from "../src/index.js";

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
		const memrez = createMemrez({
			store,
			reasoner: new DeterministicReasoner(),
		});
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
		const memrez = createMemrez({
			store,
			reasoner: new DeterministicReasoner(),
		});

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

	it("hard-deletes entries and scope subtrees, clearing topic rows and meta", async () => {
		const { dir, path } = tempDbPath();
		tempDirs.push(dir);
		const store = new SqliteMemoryStore(path);
		const now = new Date().toISOString();
		const put = (id: string, scope: string) =>
			store.putEntry({
				id,
				scope,
				content: id,
				topics: ["prefs"],
				type: "fact",
				status: "active",
				createdAt: now,
				updatedAt: now,
			});

		await put("mem_user", "gymtext/user/123");
		await put("mem_session", "gymtext/user/123/session/s1");
		await put("mem_sibling", "gymtext/user/124");
		await store.setTopicMeta("gymtext/user/123", "prefs", { blurb: "b" });
		await store.setTopicMeta("gymtext/user/123/session/s1", "prefs", {
			blurb: "b2",
		});
		await store.setTopicMeta("gymtext/user/124", "prefs", { blurb: "keep" });

		// deleteEntry removes the row and (via FK cascade) its topic rows.
		expect(await store.deleteEntry("mem_user")).toBe(true);
		expect(await store.deleteEntry("mem_user")).toBe(false);
		expect(await store.getEntry("mem_user")).toBeNull();
		expect(await store.getByTopic(["gymtext/user/123"], "prefs")).toHaveLength(
			0,
		);

		// deleteScope recursive: remaining subtree entry + both subtree meta rows;
		// the sibling user is untouched.
		const res = await store.deleteScope("gymtext/user/123", {
			recursive: true,
		});
		expect(res.entries).toBe(1); // mem_session
		expect(res.topicMeta).toBe(2); // user/123 + session meta
		const remaining = await store.listEntries({ includeSuperseded: true });
		expect(remaining.map((entry) => entry.scope)).toEqual(["gymtext/user/124"]);
		expect(
			await store.getTopicMeta("gymtext/user/124", "prefs"),
		).not.toBeNull();
		store.close();
	});

	it("deleteScope treats LIKE metacharacters in scopes literally", async () => {
		const { dir, path } = tempDbPath();
		tempDirs.push(dir);
		const store = new SqliteMemoryStore(path);
		const now = new Date().toISOString();
		const put = (id: string, scope: string) =>
			store.putEntry({
				id,
				scope,
				content: id,
				topics: ["t"],
				type: "fact",
				status: "active",
				createdAt: now,
				updatedAt: now,
			});

		await put("a", "app/u_1"); // exact prefix (underscore is literal)
		await put("c", "app/u_1/child"); // real descendant
		await put("d", "app/uX1/child"); // wrongly deleted if `_` acted as a wildcard

		const res = await store.deleteScope("app/u_1", { recursive: true });
		expect(res.entries).toBe(2); // a + c only
		const remaining = await store.listEntries();
		expect(remaining.map((entry) => entry.scope)).toEqual(["app/uX1/child"]);
		store.close();
	});

	it("enumerates dirty topics across all scopes and clears them via meta", async () => {
		const { dir, path } = tempDbPath();
		tempDirs.push(dir);
		const store = new SqliteMemoryStore(path);
		const memrez = createMemrez({
			store,
			reasoner: new DeterministicReasoner(),
		});

		await memrez.write(["app/user/u_123"], "Prefers email.", {
			topicsHint: ["prefs"],
		});
		await memrez.write(["app/user/u_456"], "Wants strength.", {
			topicsHint: ["goals"],
		});

		expect(await store.listDirtyTopics()).toEqual([
			{ scope: "app/user/u_123", topic: "prefs" },
			{ scope: "app/user/u_456", topic: "goals" },
		]);
		expect(
			(await store.listTopics(["app/user/u_123"]))[0].hasUncuratedWrites,
		).toBe(true);

		await new Promise((resolve) => setTimeout(resolve, 2));
		await store.setTopicMeta("app/user/u_123", "prefs", {
			lastUpdatedAt: new Date().toISOString(),
		});

		expect(await store.listDirtyTopics()).toEqual([
			{ scope: "app/user/u_456", topic: "goals" },
		]);
		expect(
			(await store.listTopics(["app/user/u_123"]))[0].hasUncuratedWrites,
		).toBe(false);
		store.close();
	});
});

function tempDbPath(): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), "memrez-sqlite-"));
	return { dir, path: join(dir, "memrez.db") };
}
