import { describe, expect, it } from "vitest";
import { AgntzClient, type MultiplexedRunEvent, type Run } from "../src/index.js";
import type { RunListFilter } from "../src/index.js";
import { jsonResponse, mockFetch, sseResponse } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

function sampleRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "run_abc",
    rootId: "run_abc",
    agentId: "a1",
    userId: "u1",
    status: "running",
    input: "go",
    startedAt: 1_700_000_000_000,
    depth: 0,
    ...overrides,
  };
}

describe("AgntzClient.runs.start", () => {
  it("POST /runs with body and Bearer, returns the Run handle", async () => {
    const handle = sampleRun({ status: "running" });
    const mock = mockFetch(() => jsonResponse(201, handle));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const out = await client.runs.start({ agentId: "a1", input: { x: 1 }, sessionId: "s" });
    expect(out).toEqual(handle);
    const call = mock.calls[0]!;
    expect(call.url).toBe(`${BASE}/runs`);
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(call.init.body as string)).toEqual({
      agentId: "a1",
      input: { x: 1 },
      sessionId: "s",
    });
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("omits input/sessionId when not provided", async () => {
    const mock = mockFetch(() => jsonResponse(201, sampleRun()));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    await client.runs.start({ agentId: "a1" });
    expect(JSON.parse(mock.calls[0]!.init.body as string)).toEqual({ agentId: "a1" });
  });
});

describe("AgntzClient.runs.get", () => {
  it("GET /runs/:id and returns the run", async () => {
    const run = sampleRun({ status: "completed" });
    const mock = mockFetch(() => jsonResponse(200, run));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const out = await client.runs.get("run_abc");
    expect(out).toEqual(run);
    expect(mock.calls[0]!.url).toBe(`${BASE}/runs/run_abc`);
    expect(mock.calls[0]!.init.method).toBe("GET");
  });

  it("URL-encodes runId", async () => {
    const mock = mockFetch(() => jsonResponse(200, sampleRun()));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    await client.runs.get("run/has slash");
    expect(mock.calls[0]!.url).toBe(`${BASE}/runs/run%2Fhas%20slash`);
  });
});

describe("AgntzClient.runs.cancel", () => {
  it("POST /runs/:id/cancel and returns updated run", async () => {
    const run = sampleRun({ status: "cancelled" });
    const mock = mockFetch(() => jsonResponse(200, run));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const out = await client.runs.cancel("run_abc");
    expect(out.status).toBe("cancelled");
    expect(mock.calls[0]!.url).toBe(`${BASE}/runs/run_abc/cancel`);
    expect(mock.calls[0]!.init.method).toBe("POST");
  });
});

describe("AgntzClient.runs.stream", () => {
  it("yields multiplexed events and ends on run-complete", async () => {
    const events: MultiplexedRunEvent[] = [
      { type: "run-spawn", runId: "run_abc", agentId: "a1", seq: 1 },
      { type: "text-delta", runId: "run_abc", text: "hi", seq: 2 },
      {
        type: "run-complete",
        runId: "run_abc",
        result: {
          output: "done",
          invocationId: "run_abc",
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          duration: 0,
          model: "manifest",
        },
        seq: 3,
      },
    ];
    const chunks = events.map(
      (ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\nid: ${ev.seq}\n\n`,
    );
    const mock = mockFetch(() => sseResponse(chunks));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });

    const collected: MultiplexedRunEvent[] = [];
    for await (const ev of client.runs.stream({ runId: "run_abc" })) {
      collected.push(ev);
    }
    expect(collected).toEqual(events);
  });

  it("appends ?since=N when provided", async () => {
    const mock = mockFetch(() =>
      sseResponse([
        `event: run-cancelled\ndata: ${JSON.stringify({ type: "run-cancelled", runId: "r", seq: 5 })}\n\n`,
      ]),
    );
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const iter = client.runs.stream({ runId: "r", since: 3 });
    for await (const _ of iter) { /* drain */ }
    expect(mock.calls[0]!.url).toBe(`${BASE}/runs/r/stream?since=3`);
    expect((mock.calls[0]!.init.headers as Record<string, string>).Accept).toBe("text/event-stream");
  });

  it("handles a single snapshot frame and closes", async () => {
    const run = sampleRun({ status: "completed" });
    const mock = mockFetch(() =>
      sseResponse([`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`]),
    );
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const collected: MultiplexedRunEvent[] = [];
    for await (const ev of client.runs.stream({ runId: "run_abc" })) {
      collected.push(ev);
    }
    expect(collected).toEqual([{ type: "snapshot", run }]);
  });
});

describe("AgntzClient.runs.list", () => {
  it("calls GET /runs with no query params when filter is empty", async () => {
    const mock = mockFetch(() => jsonResponse(200, { rows: [], cursor: undefined }));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const result = await client.runs.list({});
    expect(result.rows).toEqual([]);
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;
    expect(call.url).toBe(`${BASE}/runs`);
    expect(call.init.method).toBe("GET");
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("URL-encodes filter params", async () => {
    const mock = mockFetch(() => jsonResponse(200, { rows: [] }));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const filter: RunListFilter = {
      agentId: "alpha/beta",
      status: "completed",
      startedAfter: "2026-01-01T00:00:00.000Z",
      limit: 25,
      rootsOnly: false,
    };
    await client.runs.list(filter);
    const call = mock.calls[0]!;
    const u = new URL(call.url);
    expect(u.pathname).toBe("/runs");
    expect(u.searchParams.get("agentId")).toBe("alpha/beta");
    expect(u.searchParams.get("status")).toBe("completed");
    expect(u.searchParams.get("startedAfter")).toBe("2026-01-01T00:00:00.000Z");
    expect(u.searchParams.get("limit")).toBe("25");
    expect(u.searchParams.get("rootsOnly")).toBe("false");
  });

  it("returns rows and cursor", async () => {
    const sample = {
      rows: [{ id: "r1", rootId: "r1", agentId: "a", status: "completed", input: "x", startedAt: 1, depth: 0 }],
      cursor: "abc",
    };
    const mock = mockFetch(() => jsonResponse(200, sample));
    const client = new AgntzClient({ apiKey: "k", baseUrl: BASE, fetch: mock.fetch });
    const result = await client.runs.list({});
    expect(result.cursor).toBe("abc");
    expect(result.rows[0]!.id).toBe("r1");
  });
});
