import { describe, it, expect } from "vitest";
import { resolveMCPServer } from "../../src/mcp/resolve-server.js";
import { MemoryStore } from "../../src/stores/memory.js";

describe("resolveMCPServer", () => {
  it("returns the registered config when the ref matches a kind=mcp connection id", async () => {
    const store = new MemoryStore().forUser("u1");
    await store.putConnection({
      id: "gymtext",
      kind: "mcp",
      displayName: "GymText",
      config: { url: "https://gymtex.co/mcp", headers: { Authorization: "Bearer t" } },
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
    });

    const resolved = await resolveMCPServer("gymtext", store);
    expect(resolved).toEqual({
      url: "https://gymtex.co/mcp",
      headers: { Authorization: "Bearer t" },
      source: "registered",
    });
  });

  it("treats the ref as a URL when no registered connection matches", async () => {
    const store = new MemoryStore().forUser("u1");
    const resolved = await resolveMCPServer("https://example.com/mcp", store);
    expect(resolved).toEqual({ url: "https://example.com/mcp", source: "url" });
  });

  it("forwards entry headers for URL-based refs", async () => {
    const store = new MemoryStore().forUser("u1");
    const resolved = await resolveMCPServer(
      "https://example.com/mcp",
      store,
      { Authorization: "Bearer xyz" },
    );
    expect(resolved).toEqual({
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer xyz" },
      source: "url",
    });
  });

  it("merges entry headers onto registered headers (entry wins on conflict)", async () => {
    const store = new MemoryStore().forUser("u1");
    await store.putConnection({
      id: "gymtext",
      kind: "mcp",
      displayName: "GymText",
      config: { url: "https://gymtex.co/mcp", headers: { Authorization: "Bearer base", "X-Trace": "1" } },
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
    });

    const resolved = await resolveMCPServer("gymtext", store, { Authorization: "Bearer override" });
    expect(resolved.headers).toEqual({ Authorization: "Bearer override", "X-Trace": "1" });
    expect(resolved.source).toBe("registered");
  });

  it("scopes registrations to the current user", async () => {
    const root = new MemoryStore();
    const alice = root.forUser("alice");
    const bob = root.forUser("bob");

    await alice.putConnection({
      id: "gymtext",
      kind: "mcp",
      displayName: "Alice's GymText",
      config: { url: "https://alice.example/mcp" },
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
    });

    const aliceResolved = await resolveMCPServer("gymtext", alice);
    expect(aliceResolved.source).toBe("registered");
    expect(aliceResolved.url).toBe("https://alice.example/mcp");

    const bobResolved = await resolveMCPServer("gymtext", bob);
    expect(bobResolved.source).toBe("url");
    expect(bobResolved.url).toBe("gymtext");
  });
});
