import { describe, it, expect } from "vitest";
import { parseUrlPlaceholders, buildHttpUrl } from "../src/http-url.js";

describe("parseUrlPlaceholders", () => {
  it("returns empty list for a plain URL with no placeholders", () => {
    expect(parseUrlPlaceholders("https://api.example.com/users")).toEqual([]);
  });

  it("parses a required query placeholder", () => {
    const placeholders = parseUrlPlaceholders("https://api.example.com/list?status={status}");
    expect(placeholders).toEqual([
      { name: "status", optional: false, position: "query" },
    ]);
  });

  it("parses an optional query placeholder", () => {
    const placeholders = parseUrlPlaceholders("https://api.example.com/list?status={status?}");
    expect(placeholders).toEqual([
      { name: "status", optional: true, position: "query" },
    ]);
  });

  it("parses a required path placeholder", () => {
    const placeholders = parseUrlPlaceholders("https://api.example.com/users/{userId}/orders");
    expect(placeholders).toEqual([
      { name: "userId", optional: false, position: "path" },
    ]);
  });

  it("parses an optional path placeholder (parser is permissive; validator rejects)", () => {
    // The parser does not enforce the path-vs-query optional rule — it just
    // describes what's there. The structural validator then rejects optional
    // placeholders that appear in the path.
    const placeholders = parseUrlPlaceholders("https://api.example.com/users/{userId?}");
    expect(placeholders).toEqual([
      { name: "userId", optional: true, position: "path" },
    ]);
  });

  it("classifies placeholders by position relative to the first '?'", () => {
    const placeholders = parseUrlPlaceholders(
      "https://api.example.com/users/{userId}/orders?status={status}&limit={limit?}",
    );
    expect(placeholders).toEqual([
      { name: "userId", optional: false, position: "path" },
      { name: "status", optional: false, position: "query" },
      { name: "limit", optional: true, position: "query" },
    ]);
  });

  it("returns one entry per occurrence of a repeated placeholder", () => {
    const placeholders = parseUrlPlaceholders(
      "https://api.example.com/x/{id}/y/{id}",
    );
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0].name).toBe("id");
    expect(placeholders[1].name).toBe("id");
  });
});

describe("buildHttpUrl", () => {
  it("passes through a URL with no placeholders unchanged", () => {
    const url = buildHttpUrl("https://api.example.com/users", {});
    expect(url).toBe("https://api.example.com/users");
  });

  it("substitutes a required path placeholder with URL-encoded value", () => {
    const url = buildHttpUrl("https://api.example.com/users/{userId}", {
      userId: "alice",
    });
    expect(url).toBe("https://api.example.com/users/alice");
  });

  it("URL-encodes slashes in path values", () => {
    const url = buildHttpUrl("https://api.example.com/users/{userId}", {
      userId: "a/b",
    });
    expect(url).toBe("https://api.example.com/users/a%2Fb");
  });

  it("URL-encodes other special characters in path values", () => {
    const url = buildHttpUrl("https://api.example.com/q/{term}", {
      term: "a b&c",
    });
    expect(url).toBe("https://api.example.com/q/a%20b%26c");
  });

  it("substitutes both occurrences of a placeholder appearing twice in the path", () => {
    const url = buildHttpUrl("https://api.example.com/x/{id}/y/{id}", {
      id: "42",
    });
    expect(url).toBe("https://api.example.com/x/42/y/42");
  });

  it("substitutes a required query placeholder", () => {
    const url = buildHttpUrl("https://api.example.com/list?status={status}", {
      status: "active",
    });
    expect(url).toBe("https://api.example.com/list?status=active");
  });

  it("URL-encodes special characters in query values", () => {
    const url = buildHttpUrl("https://api.example.com/q?term={term}", {
      term: "a&b=c",
    });
    // URLSearchParams encodes both '&' and '='.
    expect(url).toBe("https://api.example.com/q?term=a%26b%3Dc");
  });

  it("substitutes both path and query placeholders together", () => {
    const url = buildHttpUrl(
      "https://api.example.com/users/{userId}/orders?status={status}",
      { userId: "alice", status: "open" },
    );
    expect(url).toBe("https://api.example.com/users/alice/orders?status=open");
  });

  it("drops an optional query param entirely when its value is undefined", () => {
    const url = buildHttpUrl("https://api.example.com/list?status={status?}", {
      status: undefined,
    });
    // No `?status=` and no trailing `?`.
    expect(url).toBe("https://api.example.com/list");
  });

  it("includes an optional query param when its value is supplied", () => {
    const url = buildHttpUrl("https://api.example.com/list?status={status?}", {
      status: "active",
    });
    expect(url).toBe("https://api.example.com/list?status=active");
  });

  it("drops only the optional one when mixing required and optional in the query string", () => {
    const url = buildHttpUrl(
      "https://api.example.com/list?status={status}&limit={limit?}",
      { status: "open", limit: undefined },
    );
    expect(url).toBe("https://api.example.com/list?status=open");
  });

  it("throws when a required placeholder has no value", () => {
    expect(() =>
      buildHttpUrl("https://api.example.com/users/{userId}", {}),
    ).toThrow(/userId/);
  });

  it("throws when a required query placeholder has no value", () => {
    expect(() =>
      buildHttpUrl("https://api.example.com/list?status={status}", {}),
    ).toThrow(/status/);
  });

  it("ignores extra keys in values that don't correspond to placeholders", () => {
    const url = buildHttpUrl("https://api.example.com/users/{userId}", {
      userId: "alice",
      somethingElse: "ignored",
    });
    expect(url).toBe("https://api.example.com/users/alice");
  });
});
