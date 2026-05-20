import { describe, it, expect, vi, afterEach } from "vitest";
import { buildHttpToolDefinition, type HTTPToolEntry } from "../src/http-tool.js";
import { MapTokenCache, createTokenResolver } from "../src/auth/index.js";
import type { HTTPAuth } from "../src/auth/index.js";
import type { ToolContext } from "../src/types.js";

const noopCtx: ToolContext = {
  agentId: "test",
  invocationId: "inv_test",
  invoke: async () => ({ output: "" }) as never,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildHttpToolDefinition — body and method", () => {
  it("sends a JSON body for POST", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "create_user",
      url: "https://api.example.com/users",
      method: "POST",
      body_type: "json",
      body: { name: "{{userName}}", role: "admin" },
    };
    const state = { userName: "Ada" };
    const tool = buildHttpToolDefinition(entry, state);

    const result = await tool.execute({}, noopCtx);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/users");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ada", role: "admin" });
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends a form-urlencoded body for POST when body_type=form", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "submit",
      url: "https://api.example.com/submit",
      method: "POST",
      body_type: "form",
      body: { grant_type: "client_credentials", scope: "{{scope}}" },
    };
    const tool = buildHttpToolDefinition(entry, { scope: "read:all" });

    await tool.execute({}, noopCtx);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe("grant_type=client_credentials&scope=read%3Aall");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("appends body_type=query fields to the URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "search",
      url: "https://api.example.com/search?q=foo",
      method: "POST",
      body_type: "query",
      body: { token: "{{token}}", limit: "10" },
    };
    const tool = buildHttpToolDefinition(entry, { token: "abc" });

    await tool.execute({}, noopCtx);

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("https://api.example.com/search?q=foo&");
    expect(url).toContain("token=abc");
    expect(url).toContain("limit=10");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
  });

  it("ignores body on GET", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "noop",
      url: "https://api.example.com/x",
      method: "GET",
      body: { ignored: "yes" },
    };
    const tool = buildHttpToolDefinition(entry, {});

    await tool.execute({}, noopCtx);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.method).toBe("GET");
  });

  it("attaches auth headers from the token resolver before fetch", async () => {
    const responses = [
      // 1. token endpoint
      new Response(JSON.stringify({ access_token: "tok-xyz", expires_in: 60 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      // 2. actual API call
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);

    const cache = new MapTokenCache();
    const tokenResolver = createTokenResolver({ cache });
    const auth: HTTPAuth = {
      type: "oauth2_client_credentials",
      token_url: "https://login.example.com/oauth/token",
      client_id: "{{secrets.cid}}",
      client_secret: "{{secrets.csec}}",
    };

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "list",
      url: "https://api.example.com/list",
      method: "GET",
      auth,
    };
    const tool = buildHttpToolDefinition(
      entry,
      { secrets: { cid: "id", csec: "sec" } },
      { tokenResolver },
    );

    const result = await tool.execute({}, noopCtx);
    expect(result).toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer tok-xyz");
  });

  it("refreshes the token once on 401 and retries", async () => {
    const responses = [
      new Response(JSON.stringify({ access_token: "stale" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("unauthorized", { status: 401 }),
      new Response(JSON.stringify({ access_token: "fresh" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);

    const tokenResolver = createTokenResolver({ cache: new MapTokenCache() });
    const auth: HTTPAuth = {
      type: "oauth2_client_credentials",
      token_url: "https://login.example.com/oauth/token",
      client_id: "id",
      client_secret: "sec",
    };
    const tool = buildHttpToolDefinition(
      { kind: "http", name: "x", url: "https://api.example.com/x", method: "GET", auth },
      {},
      { tokenResolver },
    );

    const result = await tool.execute({}, noopCtx);
    expect(result).toEqual({ ok: true });
    // token + first call (401) + token refresh + retry
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const retryHeaders = (fetchMock.mock.calls[3][1] as RequestInit).headers as Record<string, string>;
    expect(retryHeaders["Authorization"]).toBe("Bearer fresh");
  });

  it("surfaces 401 after refresh retry also fails (no infinite loop)", async () => {
    const responses = [
      new Response(JSON.stringify({ access_token: "t1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("unauthorized", { status: 401 }),
      new Response(JSON.stringify({ access_token: "t2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response("still unauthorized", { status: 401 }),
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift()!);

    const tokenResolver = createTokenResolver({ cache: new MapTokenCache() });
    const tool = buildHttpToolDefinition(
      {
        kind: "http",
        name: "x",
        url: "https://api.example.com/x",
        method: "GET",
        auth: {
          type: "oauth2_client_credentials",
          token_url: "https://login.example.com/oauth/token",
          client_id: "id",
          client_secret: "sec",
        },
      },
      {},
      { tokenResolver },
    );

    const result = (await tool.execute({}, noopCtx)) as { error: string };
    expect(result.error).toContain("HTTP 401");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("scrubs known tokens and secrets from response bodies", async () => {
    const cache = new MapTokenCache();
    cache.set("k", { token: "sekret-tok-1234567890", expiresAt: Date.now() + 60_000 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ message: "invalid: sekret-tok-1234567890 also static-secret-abc" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "x",
      url: "https://api.example.com/x",
      method: "GET",
    };
    const tool = buildHttpToolDefinition(
      entry,
      { secrets: { my_api_key: "static-secret-abc" } },
      { tokenCache: cache },
    );
    const result = await tool.execute({}, noopCtx) as { message: string };
    expect(result.message).toBe("invalid: ***REDACTED*** also ***REDACTED***");
  });

  it("scrubs sensitive values from 4xx error response bodies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("error: leaked-secret-xyz-12345 is invalid", { status: 401 }),
    );
    const tool = buildHttpToolDefinition(
      { kind: "http", name: "x", url: "https://api.example.com/x", method: "GET" },
      { secrets: { tok: "leaked-secret-xyz-12345" } },
      {},
    );
    const result = await tool.execute({}, noopCtx) as { error: string; body: string };
    expect(result.body).toContain("***REDACTED***");
    expect(result.body).not.toContain("leaked-secret-xyz-12345");
  });

  it("returns an auth error when entry has auth but no resolver is wired", async () => {
    const tool = buildHttpToolDefinition(
      {
        kind: "http",
        name: "x",
        url: "https://api.example.com/x",
        method: "GET",
        auth: {
          type: "oauth2_client_credentials",
          token_url: "https://login.example.com/oauth/token",
          client_id: "id",
          client_secret: "sec",
        },
      },
      {},
      {},
    );

    const result = (await tool.execute({}, noopCtx)) as { error: string };
    expect(result.error).toContain("no tokenResolver");
  });

  it("preserves caller-supplied Content-Type header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("ok", { status: 200 }),
    );

    const entry: HTTPToolEntry = {
      kind: "http",
      name: "weird",
      url: "https://api.example.com/x",
      method: "POST",
      headers: { "content-type": "application/vnd.example+json" },
      body_type: "json",
      body: { a: 1 },
    };
    const tool = buildHttpToolDefinition(entry, {});

    await tool.execute({}, noopCtx);

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/vnd.example+json");
    expect(headers["Content-Type"]).toBeUndefined();
  });
});
