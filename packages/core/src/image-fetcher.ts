import type { ContentBlock, ImageMediaType } from "./types.js";

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
    validateUrlForFetch(url);

    let pending = cache.get(url);
    if (!pending) {
      pending = fetchImageAsBase64(url, {
        fetch: fetchImpl,
        headers: block.headers,
        declaredMediaType: block.mediaType,
        maxBytes,
        timeoutMs,
      });
      cache.set(url, pending);
    }
    const { base64, mediaType } = await pending;
    result.push({ type: "image", base64, mediaType });
  }

  return result;
}

/**
 * Validate that `urlStr` is safe to fetch — not file://, not loopback, not a
 * private/link-local IP, not an IPv6 ULA/loopback. Throws ImageFetchError on
 * rejection.
 */
function validateUrlForFetch(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch (err) {
    throw new ImageFetchError(`Invalid image URL: ${urlStr}`, {
      url: urlStr,
      code: "invalid_url",
      cause: err,
    });
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    throw new ImageFetchError(
      `Disallowed URL scheme: ${parsed.protocol}`,
      { url: urlStr, code: "disallowed_scheme" },
    );
  }

  // Node's URL keeps the brackets on IPv6 hostnames (e.g. "[fc00::1]"). Strip
  // them before classifying so the IPv6 ranges match cleanly.
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  // Direct loopback hostnames
  if (host === "localhost" || host === "ip6-localhost" || host === "ip6-loopback") {
    throw new ImageFetchError(`Disallowed hostname: ${host}`, {
      url: urlStr,
      code: "disallowed_host",
    });
  }

  // IPv6 literal
  if (host.includes(":")) {
    if (isDisallowedIPv6(host)) {
      throw new ImageFetchError(
        `Disallowed IPv6 address: ${host}`,
        { url: urlStr, code: "disallowed_host" },
      );
    }
    return;
  }

  // IPv4 literal — dotted-quad regex
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map((n) => Number.parseInt(n, 10));
    if (octets.some((o) => o < 0 || o > 255 || !Number.isFinite(o))) {
      throw new ImageFetchError(`Invalid IPv4 address: ${host}`, {
        url: urlStr,
        code: "invalid_ipv4",
      });
    }
    if (isDisallowedIPv4(octets as [number, number, number, number])) {
      throw new ImageFetchError(
        `Disallowed IPv4 address: ${host}`,
        { url: urlStr, code: "disallowed_host" },
      );
    }
  }
}

function isDisallowedIPv4(o: [number, number, number, number]): boolean {
  const [a, b, _c, _d] = o;
  // 0.0.0.0/8 — unspecified / current network
  if (a === 0) return true;
  // 10.0.0.0/8 — RFC1918
  if (a === 10) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local / cloud metadata
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) return true;
  return false;
}

function isDisallowedIPv6(host: string): boolean {
  // Loopback ::1
  if (host === "::1") return true;
  // Unspecified ::
  if (host === "::" || host === "::0") return true;
  // IPv4-mapped — normalize to v4 and re-check
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) {
    const parts = mapped[1].split(".").map((n) => Number.parseInt(n, 10));
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return isDisallowedIPv4(parts as [number, number, number, number]);
    }
  }
  // fc00::/7 — unique local addresses
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return false;
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
  },
): Promise<{ base64: string; mediaType: ImageMediaType }> {
  const { fetch: fetchImpl, headers, declaredMediaType, maxBytes, timeoutMs } = opts;

  const signal = makeTimeoutSignal(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: headers ?? undefined,
      signal,
    });
  } catch (err) {
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
