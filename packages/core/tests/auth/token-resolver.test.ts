import { describe, it, expect, vi } from "vitest";
import {
  AuthError,
  MapTokenCache,
  createTokenResolver,
  type HTTPAuth,
} from "../../src/auth/index.js";

function mockFetch(responses: Array<Partial<Response> & { body?: string; status?: number; headers?: Record<string, string> }>) {
  let i = 0;
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const body = next.body ?? "";
    const status = next.status ?? 200;
    return new Response(body, {
      status,
      headers: next.headers ?? { "content-type": "application/json" },
    });
  });
}

describe("createTokenResolver — token_exchange", () => {
  const baseAuth: HTTPAuth = {
    type: "token_exchange",
    request: {
      url: "https://auth.example.com/token",
      method: "POST",
      body_type: "json",
      body: { username: "{{secrets.user}}", password: "{{secrets.pass}}" },
    },
    extract: { token_path: "$.access_token", expires_path: "$.expires_in" },
    apply: { location: "header", name: "Authorization", format: "Bearer {token}" },
  };

  it("fetches a token, applies as Bearer Authorization, and caches", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ access_token: "tok-1", expires_in: 60 }) },
    ]);
    const cache = new MapTokenCache();
    const resolver = createTokenResolver({ cache, fetchImpl });

    const state = { secrets: { user: "u", pass: "p" } };
    const a = await resolver.resolve(baseAuth, state, {});
    expect(a).toEqual({ headers: { Authorization: "Bearer tok-1" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const b = await resolver.resolve(baseAuth, state, {});
    expect(b).toEqual({ headers: { Authorization: "Bearer tok-1" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cache hit
  });

  it("interpolates {{secrets.X}} in the token request body", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ access_token: "x" }) },
    ]);
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    await resolver.resolve(baseAuth, { secrets: { user: "alice", pass: "swordfish" } }, {});

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ username: "alice", password: "swordfish" });
  });

  it("extracts via nested JSONPath", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ data: { accessToken: "deep-tok" } }) },
    ]);
    const auth: HTTPAuth = {
      ...baseAuth,
      extract: { token_path: "$.data.accessToken" },
    };
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    const applied = await resolver.resolve(auth, {}, {});
    expect(applied).toEqual({ headers: { Authorization: "Bearer deep-tok" } });
  });

  it("supports response_format: text (whole body is the token)", async () => {
    const fetchImpl = mockFetch([
      { body: "raw-token-abc", headers: { "content-type": "text/plain" } },
    ]);
    const auth: HTTPAuth = {
      ...baseAuth,
      extract: { response_format: "text" },
      apply: { location: "header", name: "X-Auth-Token", format: "{token}" },
    };
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    const applied = await resolver.resolve(auth, {}, {});
    expect(applied).toEqual({ headers: { "X-Auth-Token": "raw-token-abc" } });
  });

  it("supports apply.location=query", async () => {
    const fetchImpl = mockFetch([{ body: JSON.stringify({ access_token: "qtok" }) }]);
    const auth: HTTPAuth = {
      ...baseAuth,
      apply: { location: "query", name: "access_token", format: "{token}" },
    };
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });
    expect(await resolver.resolve(auth, {}, {})).toEqual({
      query: { access_token: "qtok" },
    });
  });

  it("dedupes concurrent token fetches (single-flight)", async () => {
    let resolveOuter!: (text: string) => void;
    const gated = new Promise<string>((res) => { resolveOuter = res; });
    const fetchImpl = vi.fn(async () => new Response(await gated, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    const p1 = resolver.resolve(baseAuth, {}, {});
    const p2 = resolver.resolve(baseAuth, {}, {});
    const p3 = resolver.resolve(baseAuth, {}, {});

    resolveOuter(JSON.stringify({ access_token: "shared" }));
    const [a, b, c] = await Promise.all([p1, p2, p3]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ headers: { Authorization: "Bearer shared" } });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("invalidates and re-fetches on demand", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ access_token: "first" }) },
      { body: JSON.stringify({ access_token: "second" }) },
    ]);
    const cache = new MapTokenCache();
    const resolver = createTokenResolver({ cache, fetchImpl });

    expect(await resolver.resolve(baseAuth, {}, {})).toEqual({
      headers: { Authorization: "Bearer first" },
    });
    await resolver.invalidate(baseAuth, {});
    expect(await resolver.resolve(baseAuth, {}, {})).toEqual({
      headers: { Authorization: "Bearer second" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("isolates cache by ownerId", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ access_token: "owner-A" }) },
      { body: JSON.stringify({ access_token: "owner-B" }) },
    ]);
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    expect(await resolver.resolve(baseAuth, {}, { ownerId: "A" })).toEqual({
      headers: { Authorization: "Bearer owner-A" },
    });
    expect(await resolver.resolve(baseAuth, {}, { ownerId: "B" })).toEqual({
      headers: { Authorization: "Bearer owner-B" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("expires cached tokens past their expiresAt", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ access_token: "t1", expires_in: 1 }) },
      { body: JSON.stringify({ access_token: "t2" }) },
    ]);
    let nowVal = 1_000_000;
    const resolver = createTokenResolver({
      cache: new MapTokenCache(),
      fetchImpl,
      now: () => nowVal,
    });

    expect(await resolver.resolve(baseAuth, {}, {})).toEqual({
      headers: { Authorization: "Bearer t1" },
    });
    nowVal += 2_000; // past 1s TTL
    expect(await resolver.resolve(baseAuth, {}, {})).toEqual({
      headers: { Authorization: "Bearer t2" },
    });
  });

  it("throws AuthError on token endpoint 4xx", async () => {
    const fetchImpl = mockFetch([{ status: 401, body: "bad creds" }]);
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });
    await expect(resolver.resolve(baseAuth, {}, {})).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError when token_path resolves to nothing", async () => {
    const fetchImpl = mockFetch([{ body: JSON.stringify({ something_else: "x" }) }]);
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });
    await expect(resolver.resolve(baseAuth, {}, {})).rejects.toBeInstanceOf(AuthError);
  });
});

describe("createTokenResolver — oauth2_client_credentials preset", () => {
  it("sends form body with grant_type and basic auth header by default", async () => {
    const fetchImpl = mockFetch([
      { body: JSON.stringify({ access_token: "oauth-tok", expires_in: 3600 }) },
    ]);
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    const auth: HTTPAuth = {
      type: "oauth2_client_credentials",
      token_url: "https://login.example.com/oauth/token",
      client_id: "{{secrets.cid}}",
      client_secret: "{{secrets.csec}}",
      scope: "read:all",
    };
    const state = { secrets: { cid: "my-id", csec: "my-secret" } };

    const applied = await resolver.resolve(auth, state, {});
    expect(applied).toEqual({ headers: { Authorization: "Bearer oauth-tok" } });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://login.example.com/oauth/token");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    // base64("my-id:my-secret") = "bXktaWQ6bXktc2VjcmV0"
    expect(headers["Authorization"]).toBe("Basic bXktaWQ6bXktc2VjcmV0");
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toBe("grant_type=client_credentials&scope=read%3Aall");
  });

  it("supports creds_location=body (creds in form fields instead of header)", async () => {
    const fetchImpl = mockFetch([{ body: JSON.stringify({ access_token: "x" }) }]);
    const resolver = createTokenResolver({ cache: new MapTokenCache(), fetchImpl });

    const auth: HTTPAuth = {
      type: "oauth2_client_credentials",
      token_url: "https://login.example.com/token",
      client_id: "{{secrets.cid}}",
      client_secret: "{{secrets.csec}}",
      creds_location: "body",
    };
    await resolver.resolve(auth, { secrets: { cid: "id", csec: "sec" } }, {});

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    expect(init.body).toBe("grant_type=client_credentials&client_id=id&client_secret=sec");
  });
});
