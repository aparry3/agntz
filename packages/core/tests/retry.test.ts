import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/utils/retry.js";

describe("withRetry", () => {
  it("should return result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on retryable errors", async () => {
    const error = new Error("rate limit exceeded");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { initialDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should retry on 429 status code", async () => {
    const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { initialDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should retry on 500 status code", async () => {
    const error = Object.assign(new Error("Internal Server Error"), { status: 500 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { initialDelayMs: 10 });
    expect(result).toBe("ok");
  });

  it("should NOT retry on non-retryable errors", async () => {
    const error = new Error("Invalid API key");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { initialDelayMs: 10 })).rejects.toThrow("Invalid API key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should exhaust retries and throw last error", async () => {
    const error = new Error("rate limit exceeded");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelayMs: 10 })
    ).rejects.toThrow("rate limit exceeded");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("should respect maxRetries config", async () => {
    const error = new Error("rate limit exceeded");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, { maxRetries: 1, initialDelayMs: 10 })
    ).rejects.toThrow("rate limit exceeded");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should abort when signal is aborted", async () => {
    const controller = new AbortController();
    const error = new Error("rate limit exceeded");
    const fn = vi.fn().mockRejectedValue(error);

    // Abort immediately
    controller.abort();

    await expect(
      withRetry(fn, { initialDelayMs: 10 }, controller.signal)
    ).rejects.toThrow("Retry aborted");
  });

  it("should retry on connection errors", async () => {
    const error = new Error("ECONNRESET");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { initialDelayMs: 10 });
    expect(result).toBe("ok");
  });

  it("should retry on socket hang up", async () => {
    const error = new Error("socket hang up");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { initialDelayMs: 10 });
    expect(result).toBe("ok");
  });

  it("should work with zero retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
