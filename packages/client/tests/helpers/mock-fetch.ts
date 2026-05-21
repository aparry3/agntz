export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface MockFetch {
  fetch: typeof fetch;
  calls: RecordedCall[];
}

export type Handler = (
  url: string,
  init: RequestInit,
) => Response | Promise<Response>;

export function mockFetch(handler: Handler): MockFetch {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const effectiveInit = init as RequestInit;
    calls.push({ url, init: effectiveInit });
    if (effectiveInit.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    return handler(url, effectiveInit);
  };
  return { fetch: impl, calls };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Build an SSE response whose chunks are emitted one at a time, pausing on a gate. */
export function gatedSseResponse(chunks: string[]): {
  response: Response;
  release: () => void;
} {
  const encoder = new TextEncoder();
  let gate!: () => void;
  const gatePromise = new Promise<void>((resolve) => {
    gate = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (chunks[0]) controller.enqueue(encoder.encode(chunks[0]));
      await gatePromise;
      for (const chunk of chunks.slice(1)) {
        controller.enqueue(encoder.encode(chunk));
        await Promise.resolve();
      }
      controller.close();
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    release: gate,
  };
}
