import { describe, it, expect } from "vitest";
import {
  SENSITIVE_HEADER_NAMES,
  collectSensitiveValues,
  redactHeaders,
  scrubString,
  scrubValue,
  MapTokenCache,
} from "../../src/auth/index.js";

describe("scrubString", () => {
  it("replaces every occurrence of a sensitive substring", () => {
    expect(scrubString("token is abc123xyz; abc123xyz again", ["abc123xyz"]))
      .toBe("token is ***REDACTED***; ***REDACTED*** again");
  });

  it("does not scrub substrings shorter than the minimum length", () => {
    expect(scrubString("hi a! a! a!", ["a"])).toBe("hi a! a! a!");
  });

  it("returns text unchanged when nothing matches", () => {
    expect(scrubString("hello world", ["topsecret-xxx"])).toBe("hello world");
  });
});

describe("scrubValue", () => {
  it("recursively scrubs strings inside arrays and objects", () => {
    const input = {
      message: "denied for token abc123xyz",
      meta: ["abc123xyz", { nested: "abc123xyz" }],
      n: 42,
      flag: true,
    };
    const result = scrubValue(input, ["abc123xyz"]);
    expect(result).toEqual({
      message: "denied for token ***REDACTED***",
      meta: ["***REDACTED***", { nested: "***REDACTED***" }],
      n: 42,
      flag: true,
    });
  });
});

describe("redactHeaders", () => {
  it("redacts known sensitive header names case-insensitively", () => {
    const out = redactHeaders({
      Authorization: "Bearer secret-token",
      "X-API-Key": "k123",
      "X-Trace": "abc",
    });
    expect(out["Authorization"]).toBe("***REDACTED***");
    expect(out["X-API-Key"]).toBe("***REDACTED***");
    expect(out["X-Trace"]).toBe("abc");
  });

  it("covers the standard sensitive header set", () => {
    for (const h of ["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token", "proxy-authorization"]) {
      expect(SENSITIVE_HEADER_NAMES.has(h)).toBe(true);
    }
  });
});

describe("collectSensitiveValues", () => {
  it("returns secret values + cache tokens above the minimum length", () => {
    const cache = new MapTokenCache();
    cache.set("k", { token: "live-token-value-long-enough", expiresAt: Date.now() + 60_000 });
    const values = collectSensitiveValues({
      tokenCache: cache,
      secrets: { api_key: "long-static-secret", short: "x" },
    });
    expect(values).toContain("long-static-secret");
    expect(values).toContain("live-token-value-long-enough");
    // Short values should be dropped to avoid over-scrubbing
    expect(values).not.toContain("x");
  });
});
