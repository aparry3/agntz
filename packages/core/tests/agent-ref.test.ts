import { describe, it, expect } from "vitest";
import {
  parseAgentRef,
  formatAgentRef,
  isIsoTimestamp,
  isAliasName,
} from "../src/agent-ref.js";
import { InvalidAgentRefError } from "../src/errors.js";

describe("parseAgentRef", () => {
  it("parses bare id without version", () => {
    expect(parseAgentRef("reviewer")).toEqual({ agentId: "reviewer" });
  });

  it("parses @latest", () => {
    expect(parseAgentRef("reviewer@latest")).toEqual({
      agentId: "reviewer",
      version: "latest",
    });
  });

  it("parses ISO timestamp with millis", () => {
    expect(parseAgentRef("reviewer@2026-05-17T15:30:00.000Z")).toEqual({
      agentId: "reviewer",
      version: "2026-05-17T15:30:00.000Z",
    });
  });

  it("parses ISO timestamp without millis", () => {
    expect(parseAgentRef("reviewer@2026-05-17T15:30:00Z")).toEqual({
      agentId: "reviewer",
      version: "2026-05-17T15:30:00Z",
    });
  });

  it("accepts ids with hyphens and underscores", () => {
    expect(parseAgentRef("my_agent-v2")).toEqual({ agentId: "my_agent-v2" });
  });

  it("accepts ids with colons (system:foo pattern)", () => {
    expect(parseAgentRef("system:summarize")).toEqual({
      agentId: "system:summarize",
    });
  });

  it("accepts ids with dots", () => {
    expect(parseAgentRef("foo.bar")).toEqual({ agentId: "foo.bar" });
  });

  it("parses an alias", () => {
    expect(parseAgentRef("reviewer@stable")).toEqual({
      agentId: "reviewer",
      version: "stable",
    });
  });

  it("parses an alias with hyphens", () => {
    expect(parseAgentRef("reviewer@pre-tools-overhaul")).toEqual({
      agentId: "reviewer",
      version: "pre-tools-overhaul",
    });
  });

  it("parses an alias that looks like a version tag", () => {
    expect(parseAgentRef("reviewer@v1-launch")).toEqual({
      agentId: "reviewer",
      version: "v1-launch",
    });
  });

  it.each([
    ["empty string", ""],
    ["only @", "@"],
    ["leading @", "@latest"],
    ["empty version", "foo@"],
    ["double @", "foo@bar@baz"],
    ["whitespace inside", "foo bar"],
    ["leading whitespace", " foo"],
    ["trailing whitespace", "foo "],
    ["whitespace before @", "foo @latest"],
    ["whitespace after @", "foo@ latest"],
    ["alias starts with hyphen", "foo@-bad"],
    ["alias starts with dot", "foo@.bad"],
    ["alias with slash", "foo@bad/alias"],
    ["alias with colon", "foo@bad:alias"],
    ["invalid month", "foo@2026-13-17T15:30:00.000Z"],
    ["invalid day", "foo@2026-05-99T15:30:00.000Z"],
    ["missing Z", "foo@2026-05-17T15:30:00.000"],
    ["missing T", "foo@2026-05-17 15:30:00.000Z"],
    ["timezone offset", "foo@2026-05-17T15:30:00+00:00"],
  ])("rejects %s", (_label, input) => {
    expect(() => parseAgentRef(input)).toThrow(InvalidAgentRefError);
  });

  it("InvalidAgentRefError carries the input verbatim", () => {
    try {
      parseAgentRef("foo@-bogus");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidAgentRefError);
      expect((err as InvalidAgentRefError).input).toBe("foo@-bogus");
      expect((err as InvalidAgentRefError).code).toBe("INVALID_AGENT_REF");
    }
  });

  it("rejects non-string input", () => {
    expect(() => parseAgentRef(undefined as unknown as string)).toThrow(
      InvalidAgentRefError,
    );
    expect(() => parseAgentRef(null as unknown as string)).toThrow(
      InvalidAgentRefError,
    );
    expect(() => parseAgentRef(42 as unknown as string)).toThrow(
      InvalidAgentRefError,
    );
  });
});

describe("formatAgentRef", () => {
  it("formats bare id", () => {
    expect(formatAgentRef({ agentId: "reviewer" })).toBe("reviewer");
  });

  it("formats with @latest", () => {
    expect(formatAgentRef({ agentId: "reviewer", version: "latest" })).toBe(
      "reviewer@latest",
    );
  });

  it("formats with ISO timestamp", () => {
    expect(
      formatAgentRef({
        agentId: "reviewer",
        version: "2026-05-17T15:30:00.000Z",
      }),
    ).toBe("reviewer@2026-05-17T15:30:00.000Z");
  });

  it("round-trips parseAgentRef ↔ formatAgentRef", () => {
    const inputs = [
      "reviewer",
      "reviewer@latest",
      "reviewer@2026-05-17T15:30:00.000Z",
      "reviewer@stable",
      "reviewer@pre-tools-overhaul",
      "my-agent_v2",
      "system:foo",
    ];
    for (const input of inputs) {
      expect(formatAgentRef(parseAgentRef(input))).toBe(input);
    }
  });
});

describe("isAliasName", () => {
  it.each([
    ["stable"],
    ["prod"],
    ["pre-tools-overhaul"],
    ["v1-launch"],
    ["first.draft"],
    ["A"],
    ["v2"],
    ["my_alias_2"],
  ])("accepts %s", (input) => {
    expect(isAliasName(input)).toBe(true);
  });

  it.each([
    ["latest is reserved", "latest"],
    ["ISO timestamp", "2026-05-17T15:30:00.000Z"],
    ["empty", ""],
    ["leading hyphen", "-foo"],
    ["leading dot", ".foo"],
    ["slash", "foo/bar"],
    ["colon", "foo:bar"],
    ["whitespace", "foo bar"],
  ])("rejects %s", (_label, input) => {
    expect(isAliasName(input)).toBe(false);
  });
});

describe("isIsoTimestamp", () => {
  it("accepts ISO with millis", () => {
    expect(isIsoTimestamp("2026-05-17T15:30:00.000Z")).toBe(true);
  });

  it("accepts ISO without millis", () => {
    expect(isIsoTimestamp("2026-05-17T15:30:00Z")).toBe(true);
  });

  it("accepts ISO with one-digit fractional seconds", () => {
    expect(isIsoTimestamp("2026-05-17T15:30:00.1Z")).toBe(true);
  });

  it("accepts the canonical Date.toISOString() output", () => {
    expect(isIsoTimestamp(new Date("2026-05-17T15:30:00Z").toISOString())).toBe(
      true,
    );
  });

  it.each([
    ["empty", ""],
    ["bare keyword", "latest"],
    ["no Z", "2026-05-17T15:30:00.000"],
    ["no T", "2026-05-17 15:30:00.000Z"],
    ["offset", "2026-05-17T15:30:00.000+00:00"],
    ["bad month", "2026-13-01T00:00:00.000Z"],
    ["bad day", "2026-05-99T00:00:00.000Z"],
    ["just a date", "2026-05-17"],
  ])("rejects %s", (_label, input) => {
    expect(isIsoTimestamp(input)).toBe(false);
  });
});
