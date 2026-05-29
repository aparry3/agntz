import type { MiddlewareHandler } from "hono";

export interface RateLimitOptions {
	windowMs: number;
	max: number;
	/**
	 * Override the key extractor. Defaults to the client's IP, read from
	 * cf-connecting-ip → first x-forwarded-for entry → x-real-ip → "unknown".
	 * The "unknown" fallback shares one bucket so unproxied deployments still
	 * get a (very loose) global cap rather than no cap at all.
	 */
	keyFn?: (req: Request) => string;
}

interface Bucket {
	timestamps: number[];
}

/**
 * Per-key sliding-window rate limiter for Hono. In-memory, single-process.
 * Trades durability and cross-worker accuracy for zero dependencies; fine for
 * unauthenticated public endpoints like /build-agent where the cost we're
 * protecting against is LLM tokens, not catastrophic abuse.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
	const buckets = new Map<string, Bucket>();
	const keyFn = opts.keyFn ?? defaultKey;

	// Periodic sweep so the bucket map doesn't grow without bound for IPs that
	// never come back. Runs every windowMs (or 5 min, whichever is larger) and
	// drops buckets whose timestamps are all outside the window.
	const sweepInterval = Math.max(opts.windowMs, 5 * 60_000);
	const sweeper = setInterval(() => {
		const cutoff = Date.now() - opts.windowMs;
		for (const [k, b] of buckets) {
			b.timestamps = b.timestamps.filter((t) => t > cutoff);
			if (b.timestamps.length === 0) buckets.delete(k);
		}
	}, sweepInterval);
	sweeper.unref?.();

	return async (c, next) => {
		const key = keyFn(c.req.raw);
		const now = Date.now();
		const cutoff = now - opts.windowMs;

		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = { timestamps: [] };
			buckets.set(key, bucket);
		}
		bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

		if (bucket.timestamps.length >= opts.max) {
			const oldest = bucket.timestamps[0];
			const retryAfter = Math.max(
				1,
				Math.ceil((oldest + opts.windowMs - now) / 1000),
			);
			c.header("Retry-After", String(retryAfter));
			return c.json(
				{ error: "rate limit exceeded", retryAfterSeconds: retryAfter },
				429,
			);
		}

		bucket.timestamps.push(now);
		return next();
	};
}

function defaultKey(req: Request): string {
	const h = req.headers;
	const cf = h.get("cf-connecting-ip");
	if (cf) return cf.trim();
	const xff = h.get("x-forwarded-for");
	if (xff) return xff.split(",")[0]?.trim() || "unknown";
	const real = h.get("x-real-ip");
	if (real) return real.trim();
	return "unknown";
}
