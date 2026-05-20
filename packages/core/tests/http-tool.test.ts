import { describe, it, expect, vi, afterEach } from "vitest";
import { buildHttpToolDefinition, type HTTPToolEntry } from "../src/http-tool.js";
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
