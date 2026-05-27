import { describe, expect, it } from "vitest";
import {
  AgntzClient,
  AgntzError,
  AuthenticationError,
  NotFoundError,
} from "../src/index.js";
import { jsonResponse, mockFetch } from "./helpers/mock-fetch.js";

const BASE = "https://worker.example.com";

describe("AgntzClient.agents.run", () => {
  it("sends POST /run with Bearer auth and returns the parsed body", async () => {
    const mock = mockFetch(() =>
      jsonResponse(200, { output: "hi", state: { done: true }, sessionId: "s1" }),
    );
    const client = new AgntzClient({
      apiKey: "ar_test_abc",
      baseUrl: BASE,
      fetch: mock.fetch,
    });
    const result = await client.agents.run({
      agentId: "a1",
      input: { x: 1 },
      sessionId: "s1",
      context: ["app/user/u_123"],
    });
    expect(result).toEqual({ output: "hi", state: { done: true }, sessionId: "s1" });
    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;
    expect(call.url).toBe(`${BASE}/run`);
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ar_test_abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(call.init.body as string)).toEqual({
      agentId: "a1",
      input: { x: 1 },
      sessionId: "s1",
      context: ["app/user/u_123"],
    });
  });

  it("omits input/sessionId when not provided", async () => {
    const mock = mockFetch(() => jsonResponse(200, { output: null, state: {} }));
    const client = new AgntzClient({
      apiKey: "k",
      baseUrl: BASE,
      fetch: mock.fetch,
    });
    await client.agents.run({ agentId: "a1" });
    expect(JSON.parse(mock.calls[0]!.init.body as string)).toEqual({ agentId: "a1" });
  });

  it("throws AuthenticationError on 401", async () => {
    const mock = mockFetch(() =>
      jsonResponse(401, { error: "invalid api key" }),
    );
    const client = new AgntzClient({
      apiKey: "bad",
      baseUrl: BASE,
      fetch: mock.fetch,
    });
    await expect(client.agents.run({ agentId: "a1" })).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    await expect(client.agents.run({ agentId: "a1" })).rejects.toMatchObject({
      status: 401,
      message: "invalid api key",
    });
  });

  it("throws NotFoundError on 404", async () => {
    const mock = mockFetch(() =>
      jsonResponse(404, { error: 'Agent "x" not found' }),
    );
    const client = new AgntzClient({
      apiKey: "k",
      baseUrl: BASE,
      fetch: mock.fetch,
    });
    const err = await client.agents.run({ agentId: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).status).toBe(404);
  });

  it("throws AgntzError on 500 with fallback message", async () => {
    const mock = mockFetch(() => new Response("boom", { status: 500 }));
    const client = new AgntzClient({
      apiKey: "k",
      baseUrl: BASE,
      fetch: mock.fetch,
    });
    const err = await client.agents.run({ agentId: "a1" }).catch((e) => e);
    expect(err).toBeInstanceOf(AgntzError);
    expect((err as AgntzError).status).toBe(500);
    expect((err as AgntzError).message).toBe("HTTP 500");
  });

  it("propagates AbortError when signal is pre-aborted", async () => {
    const mock = mockFetch(() => jsonResponse(200, { output: null, state: {} }));
    const client = new AgntzClient({
      apiKey: "k",
      baseUrl: BASE,
      fetch: mock.fetch,
    });
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await client.agents
      .run({ agentId: "a1", signal: ctrl.signal })
      .catch((e) => e);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("throws from the constructor when apiKey is missing", () => {
    expect(
      () =>
        new AgntzClient({
          apiKey: "",
          baseUrl: BASE,
        }),
    ).toThrow(/apiKey/);
  });
});
