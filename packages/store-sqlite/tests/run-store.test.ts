import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteStore } from "../src/sqlite-store.js";
import type { Run, InvokeResult } from "@agntz/core";

describe("SqliteStore RunStore", () => {
  let admin: SqliteStore;
  let store: SqliteStore;
  const userId = "user_run_test";

  beforeEach(() => {
    admin = new SqliteStore(":memory:");
    store = admin.forUser(userId);
  });

  afterEach(() => {
    admin.close();
  });

  function makeRun(overrides: Partial<Run> = {}): Run {
    const id = overrides.id ?? "run-root";
    return {
      id,
      rootId: overrides.rootId ?? id,
      parentId: overrides.parentId,
      agentId: overrides.agentId ?? "test-agent",
      userId: overrides.userId,
      sessionId: overrides.sessionId,
      spawnToolUseId: overrides.spawnToolUseId,
      status: overrides.status ?? "running",
      input: overrides.input ?? "hello",
      result: overrides.result,
      error: overrides.error,
      startedAt: overrides.startedAt ?? 1_700_000_000_000,
      endedAt: overrides.endedAt,
      depth: overrides.depth ?? 0,
    };
  }

  it("round-trips a Run via putRun and getRun", async () => {
    const run = makeRun({ id: "run-1", agentId: "alpha" });
    await store.putRun(run);
    const got = await store.getRun("run-1");
    expect(got).not.toBeNull();
    expect(got!.id).toBe("run-1");
    expect(got!.rootId).toBe("run-1");
    expect(got!.agentId).toBe("alpha");
    expect(got!.status).toBe("running");
    expect(got!.input).toBe("hello");
    expect(got!.startedAt).toBe(1_700_000_000_000);
    expect(got!.depth).toBe(0);
  });

  it("returns null for an unknown run id", async () => {
    expect(await store.getRun("nope")).toBeNull();
  });

  it("persists optional fields (sessionId, spawnToolUseId, parentId) and omits undefined ones", async () => {
    const run = makeRun({
      id: "run-opts",
      parentId: "run-parent",
      sessionId: "sess-1",
      spawnToolUseId: "tool_use_42",
      depth: 2,
    });
    await store.putRun(run);
    const got = await store.getRun("run-opts");
    expect(got!.parentId).toBe("run-parent");
    expect(got!.sessionId).toBe("sess-1");
    expect(got!.spawnToolUseId).toBe("tool_use_42");
    expect(got!.depth).toBe(2);

    const minimal = makeRun({ id: "run-min" });
    await store.putRun(minimal);
    const gotMin = await store.getRun("run-min");
    expect(gotMin!.parentId).toBeUndefined();
    expect(gotMin!.sessionId).toBeUndefined();
    expect(gotMin!.spawnToolUseId).toBeUndefined();
  });

  it("upserts on putRun for the same id (status + endedAt transition)", async () => {
    const run = makeRun({ id: "run-up", status: "running" });
    await store.putRun(run);
    const result: InvokeResult = {
      output: "done!",
      invocationId: "inv-1",
      toolCalls: [
        { id: "tc-1", name: "search", input: { q: "x" }, output: "y", duration: 12 },
      ],
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      duration: 250,
      model: "gpt-5.4-mini",
    };
    await store.putRun({
      ...run,
      status: "completed",
      endedAt: 1_700_000_000_500,
      result,
    });

    const got = await store.getRun("run-up");
    expect(got!.status).toBe("completed");
    expect(got!.endedAt).toBe(1_700_000_000_500);
    expect(got!.result).toEqual(result);
    expect(got!.error).toBeUndefined();
  });

  it("stores error string for failed runs", async () => {
    const run = makeRun({
      id: "run-err",
      status: "failed",
      error: "boom",
      endedAt: 1_700_000_000_100,
    });
    await store.putRun(run);
    const got = await store.getRun("run-err");
    expect(got!.status).toBe("failed");
    expect(got!.error).toBe("boom");
    expect(got!.endedAt).toBe(1_700_000_000_100);
  });

  it("listChildren returns direct children of a parent", async () => {
    const root = makeRun({ id: "root" });
    const childA = makeRun({
      id: "a",
      rootId: "root",
      parentId: "root",
      depth: 1,
    });
    const childB = makeRun({
      id: "b",
      rootId: "root",
      parentId: "root",
      depth: 1,
    });
    const grandchild = makeRun({
      id: "a1",
      rootId: "root",
      parentId: "a",
      depth: 2,
    });

    await store.putRun(root);
    await store.putRun(childA);
    await store.putRun(childB);
    await store.putRun(grandchild);

    const kids = await store.listChildren("root");
    const ids = kids.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);

    const grandkids = await store.listChildren("a");
    expect(grandkids.map((r) => r.id)).toEqual(["a1"]);

    expect(await store.listChildren("nope")).toEqual([]);
  });

  it("listSubtree returns all descendants including the root", async () => {
    // Tree:
    //   root
    //   ├── a
    //   │   ├── a1
    //   │   └── a2
    //   └── b
    //       └── b1
    //           └── b1a
    const runs = [
      makeRun({ id: "root", rootId: "root", depth: 0 }),
      makeRun({ id: "a", rootId: "root", parentId: "root", depth: 1 }),
      makeRun({ id: "a1", rootId: "root", parentId: "a", depth: 2 }),
      makeRun({ id: "a2", rootId: "root", parentId: "a", depth: 2 }),
      makeRun({ id: "b", rootId: "root", parentId: "root", depth: 1 }),
      makeRun({ id: "b1", rootId: "root", parentId: "b", depth: 2 }),
      makeRun({ id: "b1a", rootId: "root", parentId: "b1", depth: 3 }),
    ];
    for (const r of runs) await store.putRun(r);

    const subtree = await store.listSubtree("root");
    expect(subtree.map((r) => r.id).sort()).toEqual(
      ["a", "a1", "a2", "b", "b1", "b1a", "root"]
    );
  });

  it("listSubtree returns just the root when there are no descendants", async () => {
    await store.putRun(makeRun({ id: "lonely" }));
    const subtree = await store.listSubtree("lonely");
    expect(subtree.map((r) => r.id)).toEqual(["lonely"]);
  });

  it("listSubtree returns empty when the root id does not exist", async () => {
    expect(await store.listSubtree("nope")).toEqual([]);
  });

  it("isolates runs by user across scoped instances", async () => {
    const storeA = admin.forUser("user_a");
    const storeB = admin.forUser("user_b");

    await storeA.putRun(makeRun({ id: "shared-id", agentId: "owned-by-a" }));
    await storeB.putRun(makeRun({ id: "shared-id", agentId: "owned-by-b" }));

    expect((await storeA.getRun("shared-id"))!.agentId).toBe("owned-by-a");
    expect((await storeB.getRun("shared-id"))!.agentId).toBe("owned-by-b");

    // user_a does not see user_b's children
    await storeA.putRun(
      makeRun({ id: "child-a", rootId: "shared-id", parentId: "shared-id" })
    );
    await storeB.putRun(
      makeRun({ id: "child-b", rootId: "shared-id", parentId: "shared-id" })
    );

    const aKids = await storeA.listChildren("shared-id");
    expect(aKids.map((r) => r.id)).toEqual(["child-a"]);

    const aSubtree = await storeA.listSubtree("shared-id");
    expect(aSubtree.map((r) => r.id).sort()).toEqual(["child-a", "shared-id"]);

    const bSubtree = await storeB.listSubtree("shared-id");
    expect(bSubtree.map((r) => r.id).sort()).toEqual(["child-b", "shared-id"]);
  });

  it("throws when used unscoped (no forUser)", async () => {
    await expect(admin.putRun(makeRun())).rejects.toThrow(/user not set/);
    await expect(admin.getRun("x")).rejects.toThrow(/user not set/);
    await expect(admin.listChildren("x")).rejects.toThrow(/user not set/);
    await expect(admin.listSubtree("x")).rejects.toThrow(/user not set/);
  });
});
