import { describe, it, expect } from "vitest";
import { resolveToolEntries, buildToolParams, stripPinnedParams } from "../src/tools.js";
import type { ManifestToolEntry } from "../src/types.js";

describe("resolveToolEntries", () => {
  it("resolves plain MCP tools", () => {
    const entries: ManifestToolEntry[] = [
      { kind: "mcp", server: "https://mcp.example.com", tools: ["toolA", "toolB"] },
    ];
    const resolved = resolveToolEntries(entries);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toEqual({
      name: "toolA",
      originalName: "toolA",
      server: "https://mcp.example.com",
      source: "mcp",
    });
  });

  it("resolves wrapped MCP tools", () => {
    const entries: ManifestToolEntry[] = [
      {
        kind: "mcp",
        server: "https://mcp.example.com",
        tools: [
          {
            tool: "search",
            name: "search_user",
            description: "Search by query",
            params: { user_id: "{{userId}}" },
          },
        ],
      },
    ];
    const resolved = resolveToolEntries(entries);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual({
      name: "search_user",
      description: "Search by query",
      originalName: "search",
      server: "https://mcp.example.com",
      source: "mcp",
      pinnedParams: { user_id: "{{userId}}" },
    });
  });

  it("resolves local tools", () => {
    const entries: ManifestToolEntry[] = [{ kind: "local", tools: ["calc", "date"] }];
    const resolved = resolveToolEntries(entries);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].source).toBe("local");
  });

  it("resolves agent tools", () => {
    const entries: ManifestToolEntry[] = [{ kind: "agent", agent: "researcher" }];
    const resolved = resolveToolEntries(entries);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toEqual({
      name: "researcher",
      originalName: "researcher",
      source: "agent",
      agentId: "researcher",
    });
  });
});

describe("buildToolParams", () => {
  it("merges LLM args with pinned params", () => {
    const tool = {
      name: "search_user",
      originalName: "search",
      source: "mcp" as const,
      pinnedParams: { user_id: "{{userId}}" },
    };
    const result = buildToolParams(tool, { query: "hello" }, { userId: "123" });
    expect(result).toEqual({ query: "hello", user_id: "123" });
  });

  it("passes through when no pinned params", () => {
    const tool = {
      name: "toolA",
      originalName: "toolA",
      source: "mcp" as const,
    };
    const result = buildToolParams(tool, { a: 1 }, {});
    expect(result).toEqual({ a: 1 });
  });
});

describe("stripPinnedParams", () => {
  it("removes pinned params from schema", () => {
    const schema = {
      type: "object",
      properties: {
        query: { type: "string" },
        user_id: { type: "string" },
        api_key: { type: "string" },
      },
      required: ["query", "user_id", "api_key"],
    };

    const result = stripPinnedParams(schema, {
      user_id: "{{userId}}",
      api_key: "{{apiKey}}",
    });

    expect(result.properties).toEqual({ query: { type: "string" } });
    expect(result.required).toEqual(["query"]);
  });

  it("handles schema without required", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
    };
    const result = stripPinnedParams(schema, { b: "{{x}}" });
    expect(result.properties).toEqual({ a: { type: "string" } });
  });
});
