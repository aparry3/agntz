import { describe, it, expect, vi } from "vitest";
import { normalizeImageBlocks, ImageFetchError } from "../src/image-fetcher.js";
import type { ContentBlock } from "../src/types.js";

/**
 * Build a fake `fetch` that returns a Response with the given body and
 * content-type. Optional `delayMs` simulates a slow connection so timeout
 * paths are exercisable.
 */
function fakeFetch(
  body: Uint8Array,
  contentType = "image/jpeg",
  opts: { status?: number; delayMs?: number; missingContentLength?: boolean } = {},
): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    if (opts.delayMs) {
      // Honor the caller's AbortSignal so timeouts fire deterministically.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, opts.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    const headers = new Headers({ "content-type": contentType });
    if (!opts.missingContentLength) {
      headers.set("content-length", String(body.byteLength));
    }
    return new Response(body, { status: opts.status ?? 200, headers });
  }) as unknown as typeof fetch;
}

describe("normalizeImageBlocks", () => {
  it("returns text blocks unchanged", async () => {
    const blocks: ContentBlock[] = [{ type: "text", text: "how's my form?" }];
    const out = await normalizeImageBlocks(blocks);
    expect(out).toEqual(blocks);
  });

  it("returns already-base64 image blocks unchanged", async () => {
    const blocks: ContentBlock[] = [
      { type: "image", base64: "AAAA", mediaType: "image/png" },
    ];
    const out = await normalizeImageBlocks(blocks);
    expect(out).toEqual(blocks);
  });

  it("rejects disallowed media type on base64 block", async () => {
    const blocks: ContentBlock[] = [
      // @ts-expect-error — test the runtime check for malformed callers
      { type: "image", base64: "AAAA", mediaType: "image/tiff" },
    ];
    await expect(normalizeImageBlocks(blocks)).rejects.toBeInstanceOf(
      ImageFetchError,
    );
  });

  it.each([
    ["file:///etc/passwd"],
    ["http://localhost/img.jpg"],
    ["http://10.0.0.5/img.jpg"],
    ["http://169.254.169.254/latest/meta-data/"],
    ["http://192.168.1.1/img.jpg"],
    ["http://172.16.0.1/img.jpg"],
    ["http://127.0.0.1/img.jpg"],
    ["http://[::1]/img.jpg"],
    ["http://[fc00::1]/img.jpg"],
  ])("rejects SSRF-risky URL: %s", async (url) => {
    const blocks: ContentBlock[] = [{ type: "image", url }];
    await expect(normalizeImageBlocks(blocks)).rejects.toBeInstanceOf(
      ImageFetchError,
    );
  });

  it("fetches an https image and base64-encodes the body", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn(fakeFetch(body, "image/jpeg"));
    const blocks: ContentBlock[] = [
      { type: "image", url: "https://example.test/img.jpg" },
    ];

    const out = await normalizeImageBlocks(blocks, { fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    const block = out[0] as Extract<ContentBlock, { type: "image"; base64: string }>;
    expect(block.type).toBe("image");
    expect(block.mediaType).toBe("image/jpeg");
    expect(block.base64).toBe(Buffer.from(body).toString("base64"));
  });

  it("caches duplicate URLs — same image referenced twice fetches once", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(fakeFetch(body, "image/png"));
    const url = "https://example.test/dup.png";
    const blocks: ContentBlock[] = [
      { type: "text", text: "first" },
      { type: "image", url },
      { type: "text", text: "second" },
      { type: "image", url },
    ];

    const out = await normalizeImageBlocks(blocks, { fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(4);
    const first = out[1] as Extract<ContentBlock, { type: "image"; base64: string }>;
    const second = out[3] as Extract<ContentBlock, { type: "image"; base64: string }>;
    expect(first.base64).toBe(second.base64);
    expect(first.mediaType).toBe("image/png");
  });

  it("rejects disallowed content-type from a fetched URL", async () => {
    const body = new Uint8Array([0]);
    const fetchImpl = fakeFetch(body, "text/html");
    const blocks: ContentBlock[] = [
      { type: "image", url: "https://example.test/oops.html" },
    ];
    await expect(
      normalizeImageBlocks(blocks, { fetch: fetchImpl }),
    ).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("rejects oversized body via content-length header", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = fakeFetch(body, "image/jpeg");
    const blocks: ContentBlock[] = [
      { type: "image", url: "https://example.test/big.jpg" },
    ];
    await expect(
      normalizeImageBlocks(blocks, { fetch: fetchImpl, maxBytes: 2 }),
    ).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("rejects oversized body via streaming read when content-length is missing", async () => {
    const body = new Uint8Array(8);
    const fetchImpl = fakeFetch(body, "image/jpeg", {
      missingContentLength: true,
    });
    const blocks: ContentBlock[] = [
      { type: "image", url: "https://example.test/big.jpg" },
    ];
    await expect(
      normalizeImageBlocks(blocks, { fetch: fetchImpl, maxBytes: 4 }),
    ).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("times out a slow URL", async () => {
    const body = new Uint8Array([1]);
    const fetchImpl = fakeFetch(body, "image/jpeg", { delayMs: 200 });
    const blocks: ContentBlock[] = [
      { type: "image", url: "https://example.test/slow.jpg" },
    ];
    await expect(
      normalizeImageBlocks(blocks, { fetch: fetchImpl, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(ImageFetchError);
  });

  it("forwards request headers (Twilio Basic auth scenario)", async () => {
    const body = new Uint8Array([1]);
    const fetchImpl = vi.fn(fakeFetch(body, "image/jpeg"));
    const blocks: ContentBlock[] = [
      {
        type: "image",
        url: "https://api.twilio.test/img.jpg",
        headers: { Authorization: "Basic dXNlcjpwYXNz" },
      },
    ];
    await normalizeImageBlocks(blocks, { fetch: fetchImpl });
    const [, init] = fetchImpl.mock.calls[0];
    expect((init as RequestInit).headers).toEqual({
      Authorization: "Basic dXNlcjpwYXNz",
    });
  });

  it("rejects HTTP error responses", async () => {
    const body = new Uint8Array([1]);
    const fetchImpl = fakeFetch(body, "image/jpeg", { status: 404 });
    const blocks: ContentBlock[] = [
      { type: "image", url: "https://example.test/missing.jpg" },
    ];
    await expect(
      normalizeImageBlocks(blocks, { fetch: fetchImpl }),
    ).rejects.toBeInstanceOf(ImageFetchError);
  });
});
