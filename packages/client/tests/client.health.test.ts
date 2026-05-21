import { describe, expect, it } from "vitest";
import { AgntzClient } from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers/mock-fetch.js";

describe("AgntzClient.health", () => {
  it("GETs /health and returns the body without Authorization header", async () => {
    const mock = mockFetch(() =>
      jsonResponse(200, { status: "ok", service: "agntz-worker" }),
    );
    const client = new AgntzClient({
      apiKey: "ar_test_k",
      baseUrl: "https://worker.example.com",
      fetch: mock.fetch,
    });
    const result = await client.health();
    expect(result).toEqual({ status: "ok", service: "agntz-worker" });
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;
    expect(call.url).toBe("https://worker.example.com/health");
    expect(call.init.method).toBe("GET");
    const headers = (call.init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
