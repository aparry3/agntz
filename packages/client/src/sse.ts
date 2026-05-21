import type { SseFrame } from "./types.js";

/**
 * Parse an SSE byte stream into discrete frames. Handles partial chunks,
 * \n and \r\n line endings, multi-line data:, comments, and aborts via signal.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  if (signal) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const tail = extractFinalFrame(buffer);
        if (tail) yield tail;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = findBoundary(buffer);
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const frame = parseFrame(raw);
        if (frame) yield frame;
        boundary = findBoundary(buffer);
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // reader already released
    }
    await body.cancel().catch(() => {});
  }
}

interface Boundary {
  index: number;
  length: number;
}

function findBoundary(buffer: string): Boundary | -1 {
  const idxN = buffer.indexOf("\n\n");
  const idxRN = buffer.indexOf("\r\n\r\n");
  if (idxN === -1 && idxRN === -1) return -1;
  if (idxRN !== -1 && (idxN === -1 || idxRN < idxN)) {
    return { index: idxRN, length: 4 };
  }
  return { index: idxN, length: 2 };
}

function extractFinalFrame(buffer: string): SseFrame | null {
  if (buffer.length === 0) return null;
  return parseFrame(buffer);
}

function parseFrame(raw: string): SseFrame | null {
  const lines = raw.split(/\r?\n/);
  const frame: { event?: string; data: string[]; id?: string } = { data: [] };
  let hasField = false;
  for (const line of lines) {
    if (line.length === 0) continue;
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      frame.event = value;
      hasField = true;
    } else if (field === "data") {
      frame.data.push(value);
      hasField = true;
    } else if (field === "id") {
      frame.id = value;
      hasField = true;
    }
  }
  if (!hasField) return null;
  const result: SseFrame = { data: frame.data.join("\n") };
  if (frame.event !== undefined) result.event = frame.event;
  if (frame.id !== undefined) result.id = frame.id;
  return result;
}
