import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgresStore } from "../src/postgres-store.js";
import type { Run, InvokeResult } from "@agntz/core";

/**
 * Integration tests for the PostgresStore RunStore. Runs against a real
 * Postgres instance when DATABASE_URL is set; skipped otherwise. Mirrors the
 * existing PostgresStore integration suite pattern (postgres-store.test.ts).
 *
 * Uses a per-suite tablePrefix so multiple runs don't collide.
 */
const url = process.env.DATABASE_URL;
const hasDb = !!url;

describe.skipIf(!hasDb)("PostgresStore RunStore (integration)", () => {
  let admin: PostgresStore;
  const prefix = `art_runs_${Date.now()}_`;
  const userId = `user_run_test_${Date.now()}`;

  beforeAll(async () => {
    admin = new PostgresStore({ connection: url!, tablePrefix: prefix });
  });

  afterAll(async () => {
    // Drop the test tables to keep the DB clean between runs.
    try {
      await admin.pgPool.query(`DROP TABLE IF EXISTS ${prefix}runs CASCADE`);
    } catch {
      // ignore
    }
    await admin.close();
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
    const store = admin.forUser(userId);
    const run = makeRun({ id: "pg-run-1", agentId: "alpha" });
    await store.putRun(run);
    const got = await store.getRun("pg-run-1");
    expect(got).not.toBeNull();
    expect(got!.id).toBe("pg-run-1");
    expect(got!.rootId).toBe("pg-run-1");
    expect(got!.agentId).toBe("alpha");
    expect(got!.status).toBe("running");
    expect(got!.input).toBe("hello");
    expect(got!.startedAt).toBe(1_700_000_000_000);
    expect(got!.depth).toBe(0);
  });

  it("returns null for an unknown run id", async () => {
    const store = admin.forUser(userId);
    expect(await store.getRun("pg-nope")).toBeNull();
  });

  it("persists optional fields and omits unset ones", async () => {
    const store = admin.forUser(userId);
    await store.putRun(
      makeRun({
        id: "pg-opts",
        parentId: "pg-parent",
        sessionId: "sess-1",
        spawnToolUseId: "tool_use_42",
        depth: 2,
      })
    );
    const got = await store.getRun("pg-opts");
    expect(got!.parentId).toBe("pg-parent");
    expect(got!.sessionId).toBe("sess-1");
    expect(got!.spawnToolUseId).toBe("tool_use_42");
    expect(got!.depth).toBe(2);

    await store.putRun(makeRun({ id: "pg-min" }));
    const gotMin = await store.getRun("pg-min");
    expect(gotMin!.parentId).toBeUndefined();
    expect(gotMin!.sessionId).toBeUndefined();
    expect(gotMin!.spawnToolUseId).toBeUndefined();
  });

  it("upserts on putRun for the same id (terminal transition with result)", async () => {
    const store = admin.forUser(userId);
    const run = makeRun({ id: "pg-up", status: "running" });
    await store.putRun(run);
    const result: InvokeResult = {
      output: "done!",
      invocationId: "inv-1",
      sessionId: "sess-test",
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

    const got = await store.getRun("pg-up");
    expect(got!.status).toBe("completed");
    expect(got!.endedAt).toBe(1_700_000_000_500);
    expect(got!.result).toEqual(result);
    expect(got!.error).toBeUndefined();
  });

  it("stores error string for failed runs", async () => {
    const store = admin.forUser(userId);
    await store.putRun(
      makeRun({
        id: "pg-err",
        status: "failed",
        error: "boom",
        endedAt: 1_700_000_000_100,
      })
    );
    const got = await store.getRun("pg-err");
    expect(got!.status).toBe("failed");
    expect(got!.error).toBe("boom");
    expect(got!.endedAt).toBe(1_700_000_000_100);
  });

  it("listChildren returns direct children of a parent", async () => {
    const u = `${userId}_kids_${Math.random().toString(36).slice(2, 8)}`;
    const store = admin.forUser(u);
    await store.putRun(makeRun({ id: "root", rootId: "root" }));
    await store.putRun(makeRun({ id: "a", rootId: "root", parentId: "root", depth: 1 }));
    await store.putRun(makeRun({ id: "b", rootId: "root", parentId: "root", depth: 1 }));
    await store.putRun(makeRun({ id: "a1", rootId: "root", parentId: "a", depth: 2 }));

    const kids = await store.listChildren("root");
    expect(kids.map((r) => r.id).sort()).toEqual(["a", "b"]);

    const grandkids = await store.listChildren("a");
    expect(grandkids.map((r) => r.id)).toEqual(["a1"]);

    expect(await store.listChildren("nope")).toEqual([]);
  });

  it("listSubtree returns all descendants including the root", async () => {
    const u = `${userId}_subtree_${Math.random().toString(36).slice(2, 8)}`;
    const store = admin.forUser(u);
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
    const u = `${userId}_lonely_${Math.random().toString(36).slice(2, 8)}`;
    const store = admin.forUser(u);
    await store.putRun(makeRun({ id: "lonely" }));
    expect((await store.listSubtree("lonely")).map((r) => r.id)).toEqual(["lonely"]);
  });

  it("listSubtree returns empty when the root id does not exist", async () => {
    const store = admin.forUser(`${userId}_empty`);
    expect(await store.listSubtree("nope")).toEqual([]);
  });

  it("isolates runs by user across scoped instances", async () => {
    const ua = `${userId}_isoa_${Math.random().toString(36).slice(2, 8)}`;
    const ub = `${userId}_isob_${Math.random().toString(36).slice(2, 8)}`;
    const storeA = admin.forUser(ua);
    const storeB = admin.forUser(ub);

    await storeA.putRun(makeRun({ id: "shared-id", agentId: "owned-by-a" }));
    await storeB.putRun(makeRun({ id: "shared-id", agentId: "owned-by-b" }));

    expect((await storeA.getRun("shared-id"))!.agentId).toBe("owned-by-a");
    expect((await storeB.getRun("shared-id"))!.agentId).toBe("owned-by-b");

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
    await expect(admin.putRun(makeRun({ id: "pg-unscoped" }))).rejects.toThrow(
      /user not set/
    );
    await expect(admin.getRun("x")).rejects.toThrow(/user not set/);
    await expect(admin.listChildren("x")).rejects.toThrow(/user not set/);
    await expect(admin.listSubtree("x")).rejects.toThrow(/user not set/);
  });

  describe("listRuns", () => {
    it("returns empty + no cursor when no runs", async () => {
      const u = `${userId}_lr_empty_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      const result = await store.listRuns({});
      expect(result.rows).toEqual([]);
      expect(result.cursor).toBeUndefined();
    });

    it("orders by startedAt DESC then id DESC", async () => {
      const u = `${userId}_lr_order_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      await store.putRun(makeRun({ id: "a", startedAt: 100 }));
      await store.putRun(makeRun({ id: "b", startedAt: 200 }));
      await store.putRun(makeRun({ id: "c", startedAt: 200 }));
      const { rows } = await store.listRuns({});
      expect(rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
    });

    it("excludes children by default (rootsOnly)", async () => {
      const u = `${userId}_lr_roots_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      await store.putRun(makeRun({ id: "root", startedAt: 100 }));
      await store.putRun(
        makeRun({ id: "child", startedAt: 200, parentId: "root", rootId: "root", depth: 1 }),
      );
      const { rows } = await store.listRuns({});
      expect(rows.map((r) => r.id)).toEqual(["root"]);
    });

    it("rootsOnly=false returns all runs", async () => {
      const u = `${userId}_lr_all_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      await store.putRun(makeRun({ id: "root", startedAt: 100 }));
      await store.putRun(
        makeRun({ id: "child", startedAt: 200, parentId: "root", rootId: "root", depth: 1 }),
      );
      const { rows } = await store.listRuns({ rootsOnly: false });
      expect(rows.map((r) => r.id).sort()).toEqual(["child", "root"]);
    });

    it("filters by agentId, status, startedAfter, startedBefore", async () => {
      const u = `${userId}_lr_flt_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      await store.putRun(makeRun({ id: "a", startedAt: 1_700_000_000_000, agentId: "alpha", status: "completed" }));
      await store.putRun(makeRun({ id: "b", startedAt: 1_800_000_000_000, agentId: "beta", status: "failed" }));
      const { rows } = await store.listRuns({
        agentId: "beta",
        status: "failed",
        startedAfter: "2025-01-01T00:00:00.000Z",
        startedBefore: "2030-01-01T00:00:00.000Z",
      });
      expect(rows.map((r) => r.id)).toEqual(["b"]);
    });

    it("paginates with cursor", async () => {
      const u = `${userId}_lr_page_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      await store.putRun(makeRun({ id: "a", startedAt: 100 }));
      await store.putRun(makeRun({ id: "b", startedAt: 200 }));
      await store.putRun(makeRun({ id: "c", startedAt: 300 }));
      const p1 = await store.listRuns({ limit: 2 });
      expect(p1.rows.map((r) => r.id)).toEqual(["c", "b"]);
      expect(p1.cursor).toBeDefined();
      const p2 = await store.listRuns({ limit: 2, cursor: p1.cursor });
      expect(p2.rows.map((r) => r.id)).toEqual(["a"]);
      expect(p2.cursor).toBeUndefined();
    });

    it("ignores malformed cursor", async () => {
      const u = `${userId}_lr_bad_${Math.random().toString(36).slice(2, 8)}`;
      const store = admin.forUser(u);
      await store.putRun(makeRun({ id: "a", startedAt: 100 }));
      const { rows } = await store.listRuns({ cursor: "garbage" });
      expect(rows.map((r) => r.id)).toEqual(["a"]);
    });

    it("isolates runs by user across scoped instances", async () => {
      const ua = `${userId}_lr_isoa_${Math.random().toString(36).slice(2, 8)}`;
      const ub = `${userId}_lr_isob_${Math.random().toString(36).slice(2, 8)}`;
      const storeA = admin.forUser(ua);
      const storeB = admin.forUser(ub);
      await storeA.putRun(makeRun({ id: "a-mine", startedAt: 100 }));
      await storeB.putRun(makeRun({ id: "a-other", startedAt: 200 }));
      const mine = await storeA.listRuns({});
      expect(mine.rows.map((r) => r.id)).toEqual(["a-mine"]);
    });
  });
});
