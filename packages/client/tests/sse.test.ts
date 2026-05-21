import { describe, expect, it } from "vitest";
import { parseSSE } from "../src/sse.js";
import type { SseFrame } from "../src/types.js";

const encoder = new TextEncoder();

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<SseFrame[]> {
  const out: SseFrame[] = [];
  for await (const frame of parseSSE(stream, signal)) out.push(frame);
  return out;
}

describe("parseSSE", () => {
  it("parses a single frame in one chunk", async () => {
    const frames = await collect(
      streamOf(["event: run-start\ndata: {\"a\":1}\n\n"]),
    );
    expect(frames).toEqual([{ event: "run-start", data: '{"a":1}' }]);
  });

  it("handles a frame split across chunks", async () => {
    const frames = await collect(
      streamOf(["event: run-com", "plete\ndata: {\"x", '":2}\n\n']),
    );
    expect(frames).toEqual([{ event: "run-complete", data: '{"x":2}' }]);
  });

  it("splits multiple frames from a single chunk", async () => {
    const frames = await collect(
      streamOf([
        "event: run-start\ndata: {}\n\nevent: run-complete\ndata: {}\n\n",
      ]),
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]!.event).toBe("run-start");
    expect(frames[1]!.event).toBe("run-complete");
  });

  it("joins multi-line data with newlines per SSE spec", async () => {
    const frames = await collect(streamOf(["data: line1\ndata: line2\n\n"]));
    expect(frames).toEqual([{ data: "line1\nline2" }]);
  });

  it("skips comment lines", async () => {
    const frames = await collect(
      streamOf([": heartbeat\n\nevent: run-start\ndata: {}\n\n"]),
    );
    expect(frames).toEqual([{ event: "run-start", data: "{}" }]);
  });

  it("handles CRLF line endings", async () => {
    const frames = await collect(
      streamOf(["event: run-start\r\ndata: {}\r\n\r\n"]),
    );
    expect(frames).toEqual([{ event: "run-start", data: "{}" }]);
  });

  it("decodes UTF-8 characters split across chunks", async () => {
    const bytes = encoder.encode('event: run-complete\ndata: {"text":"héllo"}\n\n');
    const mid = 30;
    const frames = await collect(streamOf([bytes.slice(0, mid), bytes.slice(mid)]));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.data).toBe('{"text":"héllo"}');
  });

  it("flushes a final frame missing a trailing boundary", async () => {
    const frames = await collect(streamOf(["event: run-start\ndata: {}"]));
    expect(frames).toEqual([{ event: "run-start", data: "{}" }]);
  });

  it("returns cleanly when aborted before any read", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const frames = await collect(streamOf(["event: run-start\ndata: {}\n\n"]), ctrl.signal);
    expect(frames).toEqual([]);
  });
});
