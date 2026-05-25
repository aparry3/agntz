import type { ContentBlock, ImageMediaType } from "./types.js";
import {
  OutboundUrlPolicyError,
  fetchWithOutboundPolicy,
  type OutboundUrlPolicyOptions,
} from "./utils/outbound-url.js";

/**
 * Image media types the runner is willing to forward to the model. The
 * allow-list is intentionally narrow — both `mediaType` declarations on the
 * input block AND the `content-type` of fetched URLs must land in this set.
 */
const ALLOWED_MEDIA_TYPES = new Set<ImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/** Maximum image body in bytes (5 MB) for both `content-length` and accumulated reads. */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** Total time budget for one URL fetch (connect + body). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Specific error thrown for any failure in `normalizeImageBlocks` — invalid
 * URL, SSRF policy rejection, fetch error, oversize body, disallowed
 * content-type, or unsupported media type. Carries the offending URL for
 * audit logs.
 */
export class ImageFetchError extends Error {
  readonly url?: string;
  readonly code: string;

  constructor(message: string, opts?: { url?: string; code?: string; cause?: unknown }) {
    super(message);
    this.name = "ImageFetchError";
    this.url = opts?.url;
    this.code = opts?.code ?? "image_fetch_error";
    if (opts?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

export interface NormalizeImageBlocksOptions {
  /** Inject a custom fetch (defaults to globalThis.fetch). */
  fetch?: typeof fetch;
  /** Override outbound URL policy. Custom test fetches skip DNS by default. */
  outboundUrlPolicy?: OutboundUrlPolicyOptions;
  /** Max body size in bytes. Defaults to 5 MB. */
  maxBytes?: number;
  /** Total per-URL timeout in ms. Defaults to 30 s. */
  timeoutMs?: number;
}

/**
 * Normalize a `ContentBlock[]` so every image block is `{type:"image", base64,
 * mediaType}` — URLs are fetched, validated, and base64-encoded; already-
 * base64 blocks pass through with mediaType validation; text blocks pass
 * through untouched.
 *
 * SSRF defense: rejects file://, localhost, RFC1918 private ranges, link-
 * local, IPv6 loopback, and unique-local addresses. The same URL appearing
 * multiple times is fetched once and reused.
 */
export async function normalizeImageBlocks(
  blocks: ContentBlock[],
  opts?: NormalizeImageBlocksOptions,
): Promise<ContentBlock[]> {
  const fetchImpl = opts?.fetch ?? globalThis.fetch;
  const outboundUrlPolicy = opts?.outboundUrlPolicy ?? (
    opts?.fetch ? { skipDnsResolution: true } : undefined
  );
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (typeof fetchImpl !== "function") {
    throw new ImageFetchError("No fetch implementation available", {
      code: "no_fetch",
    });
  }

  // Cache by URL within this call so the same URL is downloaded once even if
  // a multimodal payload references it twice.
  const cache = new Map<
    string,
    Promise<{ base64: string; mediaType: ImageMediaType }>
  >();

  const result: ContentBlock[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      result.push(block);
      continue;
    }

    // image block
    if ("base64" in block) {
      // Already materialized — just sanity-check the media type.
      if (!ALLOWED_MEDIA_TYPES.has(block.mediaType)) {
        throw new ImageFetchError(
          `Disallowed image media type: ${block.mediaType}`,
          { code: "disallowed_media_type" },
        );
      }
      result.push({
        type: "image",
        base64: block.base64,
        mediaType: block.mediaType,
      });
      continue;
    }

    // image-with-url — fetch (or reuse from cache)
    const url = block.url;

    let pending = cache.get(url);
    if (!pending) {
      pending = fetchImageAsBase64(url, {
        fetch: fetchImpl,
        headers: block.headers,
        declaredMediaType: block.mediaType,
        maxBytes,
        timeoutMs,
        outboundUrlPolicy,
      });
      cache.set(url, pending);
    }
    const { base64, mediaType } = await pending;
    result.push({ type: "image", base64, mediaType });
  }

  return result;
}

/**
 * Fetch one image URL and return its base64-encoded body + validated media
 * type. Enforces total timeout, max-bytes (both content-length and accumulated
 * reads), and an allow-list of content-types.
 */
async function fetchImageAsBase64(
  url: string,
  opts: {
    fetch: typeof fetch;
    headers?: Record<string, string>;
    declaredMediaType?: ImageMediaType;
    maxBytes: number;
    timeoutMs: number;
    outboundUrlPolicy?: OutboundUrlPolicyOptions;
  },
): Promise<{ base64: string; mediaType: ImageMediaType }> {
  const { fetch: fetchImpl, headers, declaredMediaType, maxBytes, timeoutMs, outboundUrlPolicy } = opts;

  const signal = makeTimeoutSignal(timeoutMs);
  let response: Response;
  try {
    response = await fetchWithOutboundPolicy(
      url,
      {
        method: "GET",
        headers: headers ?? undefined,
        signal,
      },
      { fetchImpl, policy: outboundUrlPolicy },
    );
  } catch (err) {
    if (err instanceof OutboundUrlPolicyError) {
      throw new ImageFetchError(err.message, {
        url,
        code: err.code,
        cause: err,
      });
    }
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || /aborted|timeout/i.test(err.message));
    throw new ImageFetchError(
      isAbort ? `Image fetch timed out after ${timeoutMs}ms` : `Image fetch failed: ${String(err)}`,
      {
        url,
        code: isAbort ? "timeout" : "fetch_failed",
        cause: err,
      },
    );
  }

  if (!response.ok) {
    throw new ImageFetchError(
      `Image fetch returned HTTP ${response.status}`,
      { url, code: `http_${response.status}` },
    );
  }

  // Validate content-type against allow-list. Strip charset/parameters.
  const rawContentType = response.headers.get("content-type") ?? "";
  const baseContentType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_MEDIA_TYPES.has(baseContentType as ImageMediaType)) {
    throw new ImageFetchError(
      `Disallowed image content-type: ${rawContentType || "(missing)"}`,
      { url, code: "disallowed_content_type" },
    );
  }
  const mediaType = baseContentType as ImageMediaType;
  if (declaredMediaType && declaredMediaType !== mediaType) {
    // Server's declared content-type wins; we just note the mismatch in
    // logs by overriding the caller's declaration.
  }

  // Check content-length up front if present
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const cl = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(cl) && cl > maxBytes) {
      throw new ImageFetchError(
        `Image too large: ${cl} bytes (max ${maxBytes})`,
        { url, code: "too_large" },
      );
    }
  }

  // Read the body incrementally so a missing/dishonest content-length can't
  // exhaust memory.
  let buffer: Buffer;
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new ImageFetchError(
            `Image too large: exceeded ${maxBytes} bytes during streaming read`,
            { url, code: "too_large" },
          );
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof ImageFetchError) throw err;
      throw new ImageFetchError(`Image body read failed: ${String(err)}`, {
        url,
        code: "read_failed",
        cause: err,
      });
    }
    buffer = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  } else {
    // No streaming body — fall back to arrayBuffer with post-hoc size check.
    const ab = await response.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      throw new ImageFetchError(
        `Image too large: ${ab.byteLength} bytes (max ${maxBytes})`,
        { url, code: "too_large" },
      );
    }
    buffer = Buffer.from(ab);
  }

  return {
    base64: buffer.toString("base64"),
    mediaType,
  };
}

/**
 * Build an AbortSignal that fires after `timeoutMs`. Prefers
 * AbortSignal.timeout (Node 18.17+ / 20+) and falls back to a manually-armed
 * AbortController.
 */
function makeTimeoutSignal(timeoutMs: number): AbortSignal {
  const Sig = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof Sig.timeout === "function") {
    return Sig.timeout(timeoutMs);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs).unref?.();
  return ctrl.signal;
}
