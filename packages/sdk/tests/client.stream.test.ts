import { describe, expect, it } from "vitest";
import {
  AgntzClient,
  AuthenticationError,
  StreamError,
  type StreamEvent,
} from "../src/index.js";
import {
  gatedSseResponse,
  jsonResponse,
  mockFetch,
  sseResponse,
} from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

function makeClient(fetchImpl: typeof fetch): AgntzClient {
  return new AgntzClient({
    apiKey: "ar_test_abc",
    baseUrl: BASE,
    fetch: fetchImpl,
  });
}

describe("AgntzClient.agents.stream", () => {
  it("yields start then complete events", async () => {
    const chunks = [
      'event: run-start\ndata: {"agentId":"a1","kind":"llm","sessionId":"s1"}\n\n',
      'event: run-complete\ndata: {"output":"hi","state":{"done":true},"sessionId":"s1"}\n\n',
    ];
    const mock = mockFetch(() => sseResponse(chunks));
    const client = makeClient(mock.fetch);

    const events: StreamEvent[] = [];
    for await (const ev of client.agents.stream({ agentId: "a1" })) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: "start", agentId: "a1", kind: "llm", sessionId: "s1" },
      { type: "complete", output: "hi", state: { done: true }, sessionId: "s1" },
    ]);

    const call = mock.calls[0]!;
    expect(call.url).toBe(`${BASE}/run/stream`);
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ar_test_abc");
    expect(headers.Accept).toBe("text/event-stream");
  });

  it("yields a run-error event then closes (does not throw)", async () => {
    const chunks = [
      'event: run-start\ndata: {"agentId":"a1","kind":"llm","sessionId":"s1"}\n\n',
      'event: run-error\ndata: {"error":"boom"}\n\n',
    ];
    const mock = mockFetch(() => sseResponse(chunks));
    const client = makeClient(mock.fetch);

    const events: StreamEvent[] = [];
    for await (const ev of client.agents.stream({ agentId: "a1" })) {
      events.push(ev);
    }
    expect(events).toEqual([
      { type: "start", agentId: "a1", kind: "llm", sessionId: "s1" },
      { type: "error", error: "boom" },
    ]);
  });

  it("closes cleanly when caller breaks out of the iterator", async () => {
    const chunks = [
      'event: run-start\ndata: {"agentId":"a1","kind":"llm","sessionId":"s1"}\n\n',
      'event: run-complete\ndata: {"output":"hi","state":{},"sessionId":"s1"}\n\n',
    ];
    const mock = mockFetch(() => sseResponse(chunks));
    const client = makeClient(mock.fetch);

    const events: StreamEvent[] = [];
    for await (const ev of client.agents.stream({ agentId: "a1" })) {
      events.push(ev);
      break;
    }
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("start");
  });

  it("terminates cleanly when the signal is aborted mid-stream", async () => {
    const gated = gatedSseResponse([
      'event: run-start\ndata: {"agentId":"a1","kind":"llm","sessionId":"s1"}\n\n',
      'event: run-complete\ndata: {"output":"hi","state":{},"sessionId":"s1"}\n\n',
    ]);
    const mock = mockFetch(() => gated.response);
    const client = makeClient(mock.fetch);
    const ctrl = new AbortController();

    const events: StreamEvent[] = [];
    const stream = client.agents.stream({ agentId: "a1", signal: ctrl.signal });
    for await (const ev of stream) {
      events.push(ev);
      ctrl.abort();
      gated.release();
    }
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("start");
  });

  it("throws StreamError when the stream closes before a terminal frame", async () => {
    const chunks = [
      'event: run-start\ndata: {"agentId":"a1","kind":"llm","sessionId":"s1"}\n\n',
    ];
    const mock = mockFetch(() => sseResponse(chunks));
    const client = makeClient(mock.fetch);

    const iter = client.agents.stream({ agentId: "a1" });
    const first = await iter.next();
    expect(first.value).toMatchObject({ type: "start" });
    await expect(iter.next()).rejects.toBeInstanceOf(StreamError);
  });

  it("throws AuthenticationError when the worker rejects before streaming", async () => {
    const mock = mockFetch(() => jsonResponse(401, { error: "bad key" }));
    const client = makeClient(mock.fetch);
    const iter = client.agents.stream({ agentId: "a1" });
    await expect(iter.next()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("deserializes `reply` SSE events into typed StreamEvent.reply", async () => {
    const chunks = [
      'event: run-start\ndata: {"agentId":"a1","kind":"llm","sessionId":"s1"}\n\n',
      `event: reply\ndata: ${JSON.stringify({
        type: "reply",
        text: "still thinking...",
        ts: "2026-05-16T12:00:00.000Z",
        sessionId: "s1",
        runId: "r1",
        seq: 2,
      })}\nid: 2\n\n`,
      `event: reply\ndata: ${JSON.stringify({
        type: "reply",
        text: "almost there",
        ts: "2026-05-16T12:00:01.000Z",
        sessionId: "s1",
        runId: "r1",
        seq: 5,
      })}\nid: 5\n\n`,
      'event: run-complete\ndata: {"output":"done","state":{},"sessionId":"s1"}\n\n',
    ];
    const mock = mockFetch(() => sseResponse(chunks));
    const client = makeClient(mock.fetch);

    const events: StreamEvent[] = [];
    for await (const ev of client.agents.stream({ agentId: "a1" })) {
      events.push(ev);
    }

    const replyEvents = events.filter((e) => e.type === "reply");
    expect(replyEvents).toHaveLength(2);
    expect(replyEvents[0]).toEqual({
      type: "reply",
      text: "still thinking...",
      ts: "2026-05-16T12:00:00.000Z",
      sessionId: "s1",
      runId: "r1",
      seq: 2,
    });
    expect(replyEvents[1]).toMatchObject({
      type: "reply",
      text: "almost there",
      seq: 5,
    });

    // Reply events sit between `start` and `complete` and don't terminate
    // the iterator.
    expect(events[0].type).toBe("start");
    expect(events[events.length - 1].type).toBe("complete");
  });
});
