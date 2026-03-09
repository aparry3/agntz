/**
 * Retry configuration for model calls.
 */
export interface RetryConfig {
  /** Maximum number of retries (default: 2, meaning up to 3 total attempts) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** HTTP status codes to retry on (default: [429, 500, 502, 503, 504]) */
  retryableStatuses?: number[];
}

const DEFAULT_RETRY: Required<RetryConfig> = {
  maxRetries: 2,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Determine if an error is retryable based on status code or error type.
 */
function isRetryable(error: unknown, retryableStatuses: number[]): boolean {
  if (error instanceof Error) {
    // Check for status code in error (common pattern in HTTP libs)
    const statusCode = (error as any).status ?? (error as any).statusCode;
    if (typeof statusCode === "number") {
      return retryableStatuses.includes(statusCode);
    }

    // Check for rate limit or server errors in message
    const msg = error.message.toLowerCase();
    if (
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("429") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("socket hang up")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Execute a function with retries and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: RetryConfig,
  signal?: AbortSignal,
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...config };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error("Retry aborted");
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt or non-retryable errors
      if (attempt === opts.maxRetries || !isRetryable(error, opts.retryableStatuses)) {
        throw error;
      }

      // Wait with exponential backoff + jitter
      const jitter = Math.random() * delay * 0.1;
      const waitTime = Math.min(delay + jitter, opts.maxDelayMs);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, waitTime);

        if (signal) {
          const onAbort = () => {
            clearTimeout(timeout);
            reject(new Error("Retry aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });

      delay *= opts.backoffMultiplier;
    }
  }

  throw lastError;
}
