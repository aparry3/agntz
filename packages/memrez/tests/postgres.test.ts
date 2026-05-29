import { describe, expect, it } from "vitest";
import { createMemrez, PostgresMemoryStore } from "../src/index.js";

const url = process.env.MEMREZ_POSTGRES_URL ?? process.env.DATABASE_URL;
const describePg = url ? describe : describe.skip;

describePg("PostgresMemoryStore", () => {
  it("persists memory entries and enforces scope visibility", async () => {
    const store = new PostgresMemoryStore({
      connection: url!,
      tablePrefix: `test_${Date.now()}_`,
    });
    const memrez = createMemrez({ store });
    try {
      await memrez.write(["app"], "Global policy.", { topicsHint: ["shared"] });
      await memrez.write(["app/user/u_123"], "User 123 preference.", {
        topicsHint: ["prefs"],
        source: { agentId: "support", runId: "run_1" },
      });
      await memrez.write(["app/user/u_456"], "User 456 preference.", {
        topicsHint: ["prefs"],
      });

      const scan = await memrez.scan(["app/user/u_123"]);
      const prefs = await memrez.read(["app/user/u_123"], "prefs");
      const shared = await memrez.read(["app/user/u_123"], "shared");

      expect(scan.topics.map((topic) => [topic.topic, topic.count])).toEqual([
        ["prefs", 1],
        ["shared", 1],
      ]);
      expect(prefs).toHaveLength(1);
      expect(prefs[0]).toMatchObject({
        scope: "app/user/u_123",
        content: "User 123 preference.",
        topics: ["prefs"],
        source: { agentId: "support", runId: "run_1" },
      });
      expect(shared.map((entry) => entry.content)).toEqual(["Global policy."]);
    } finally {
      await store.close();
    }
  });

  it("persists supersede state and topic metadata", async () => {
    const store = new PostgresMemoryStore({
      connection: url!,
      tablePrefix: `test_${Date.now()}_`,
    });
    const now = new Date().toISOString();
    try {
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
      expect(allPrefs.map((entry) => entry.id).sort()).toEqual(["mem_a", "mem_b"]);
      expect(topics).toEqual([
        {
          topic: "prefs",
          count: 1,
          blurb: "Communication preferences.",
          lastUpdatedAt: "2026-05-27T00:00:00.000Z",
          hasUncuratedWrites: true,
        },
      ]);
    } finally {
      await store.close();
    }
  });
});
