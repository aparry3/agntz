import { describe, expect, it } from "vitest";
import { MemoryStore, type Span, type TraceSummary } from "@agntz/core";
import { createWorkerAPI } from "../src/routes.js";

const SECRET = "test-secret";

function makeApp() {
  const store = new MemoryStore();
  const app = createWorkerAPI({ store, internalSecret: SECRET });
  return { app, store };
}

async function issueKey(store: MemoryStore, userId: string): Promise<string> {
  const { rawKey } = await store.forUser(userId).createApiKey({ userId, name: "test" });
  return rawKey;
}

function bearer(rawKey: string) {
  return { Authorization: `Bearer ${rawKey}` } as const;
}

function sampleSummary(overrides: Partial<TraceSummary> = {}): TraceSummary {
  return {
    traceId: "tr_1",
    ownerId: "u1",
    rootName: "manifest",
    agentId: "a1",
    startedAt: "2026-05-11T12:00:00.000Z",
    endedAt: "2026-05-11T12:00:01.000Z",
    durationMs: 1000,
    spanCount: 2,
    status: "ok",
    totalTokens: 100,
    totalCostUsd: null,
    ...overrides,
  };
}

// Used by GET /traces/:id, /traces/:id/stream, and DELETE /traces/:id tests (Tasks 2–4).
function sampleSpan(overrides: Partial<Span> = {}): Span {
  return {
    spanId: "sp_root",
    traceId: "tr_1",
    parentId: null,
    ownerId: "u1",
    runId: null,
    sessionId: null,
    name: "manifest",
    kind: "manifest",
    startedAt: "2026-05-11T12:00:00.000Z",
    endedAt: "2026-05-11T12:00:01.000Z",
    durationMs: 1000,
    status: "ok",
    error: null,
    attributes: {},
    events: [],
    scores: {},
    costUsd: null,
    ...overrides,
  };
}

describe("GET /traces/:id", () => {
  it("404 for unknown id", async () => {
    const { app, store } = makeApp();
    const rawKey = await issueKey(store, "u1");
    const res = await app.request("/traces/tr_nope", { method: "GET", headers: bearer(rawKey) });
    expect(res.status).toBe(404);
  });

  it("returns { summary, spans } for an owned terminal trace", async () => {
    const { app, store } = makeApp();
    const scoped = store.forUser("u1");
    await scoped.upsertSummary(sampleSummary({ traceId: "tr_a" }));
    await scoped.insertSpan(sampleSpan({ spanId: "sp_root", traceId: "tr_a" }));
    await scoped.insertSpan(
      sampleSpan({
        spanId: "sp_child",
        traceId: "tr_a",
        parentId: "sp_root",
        name: "step:fetch",
        kind: "step",
      }),
    );

    const rawKey = await issueKey(store, "u1");
    const res = await app.request("/traces/tr_a", { method: "GET", headers: bearer(rawKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: TraceSummary; spans: Span[] };
    expect(body.summary.traceId).toBe("tr_a");
    expect(body.spans.map((s) => s.spanId).sort()).toEqual(["sp_child", "sp_root"]);
  });

  it("404 when the trace is owned by another user", async () => {
    const { app, store } = makeApp();
    await store.forUser("u1").upsertSummary(sampleSummary({ traceId: "tr_a" }));

    const rawKey = await issueKey(store, "u2");
    const res = await app.request("/traces/tr_a", { method: "GET", headers: bearer(rawKey) });
    expect(res.status).toBe(404);
  });
});

describe("GET /traces", () => {
  it("401 without auth", async () => {
    const { app } = makeApp();
    const res = await app.request("/traces", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("returns owned summaries", async () => {
    const { app, store } = makeApp();
    const scoped = store.forUser("u1");
    await scoped.upsertSummary(sampleSummary({ traceId: "tr_a" }));
    await scoped.upsertSummary(sampleSummary({ traceId: "tr_b", agentId: "a2" }));
    await store.forUser("u2").upsertSummary(sampleSummary({ traceId: "tr_x", ownerId: "u2" }));

    const rawKey = await issueKey(store, "u1");
    const res = await app.request("/traces", { method: "GET", headers: bearer(rawKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: TraceSummary[]; cursor?: string };
    const ids = body.rows.map((r) => r.traceId).sort();
    expect(ids).toEqual(["tr_a", "tr_b"]);
  });

  it("filters by agentId", async () => {
    const { app, store } = makeApp();
    const scoped = store.forUser("u1");
    await scoped.upsertSummary(sampleSummary({ traceId: "tr_a", agentId: "a1" }));
    await scoped.upsertSummary(sampleSummary({ traceId: "tr_b", agentId: "a2" }));

    const rawKey = await issueKey(store, "u1");
    const res = await app.request("/traces?agentId=a2", { method: "GET", headers: bearer(rawKey) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: TraceSummary[] };
    expect(body.rows.map((r) => r.traceId)).toEqual(["tr_b"]);
  });

  it("400 when limit is non-numeric", async () => {
    const { app, store } = makeApp();
    const rawKey = await issueKey(store, "u1");
    const res = await app.request("/traces?limit=abc", { method: "GET", headers: bearer(rawKey) });
    expect(res.status).toBe(400);
  });
});
