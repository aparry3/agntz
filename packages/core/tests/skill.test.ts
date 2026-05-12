import { describe, it, expect } from "vitest";
import { defineSkill } from "../src/skill.js";
import type { SkillDefinition } from "../src/types.js";

describe("defineSkill", () => {
  it("accepts a minimal valid skill (name, description, instructions)", () => {
    const skill: SkillDefinition = {
      name: "researcher",
      description: "Web research with citation.",
      instructions: "Search broadly and cite sources.",
    };
    const out = defineSkill(skill);
    expect(out).toBe(skill); // returned unchanged
    expect(out.name).toBe("researcher");
  });

  it("accepts a valid skill with all optional fields", () => {
    const skill: SkillDefinition = {
      name: "summarizer",
      description: "Summarize long passages.",
      instructions: "Output a TL;DR followed by 3 bullet points.",
      tools: [
        { type: "inline", name: "web_search" },
        { type: "mcp", server: "docs-server" },
        { type: "mcp", server: "docs-server", tools: ["read", "list"] },
        { type: "agent", agentId: "outline-agent" },
      ],
      metadata: { team: "research" },
      createdAt: "2026-05-12T00:00:00Z",
      updatedAt: "2026-05-12T00:00:00Z",
    };
    const out = defineSkill(skill);
    expect(out).toBe(skill);
    expect(out.tools).toHaveLength(4);
  });

  it("accepts an empty tools array", () => {
    const out = defineSkill({
      name: "no-tools",
      description: "Has no tools.",
      instructions: "Do the thing.",
      tools: [],
    });
    expect(out.tools).toEqual([]);
  });

  it("accepts kebab-case names", () => {
    expect(() =>
      defineSkill({
        name: "multi-word-name",
        description: "ok",
        instructions: "ok",
      }),
    ).not.toThrow();
  });

  // ─── name rejections ──────────────────────────────────────────────

  it("rejects an uppercase name", () => {
    expect(() =>
      defineSkill({
        name: "Researcher",
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  it("rejects a name starting with a digit", () => {
    expect(() =>
      defineSkill({
        name: "1researcher",
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  it("rejects a name with special characters", () => {
    expect(() =>
      defineSkill({
        name: "research!",
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  it("rejects a name with underscores", () => {
    expect(() =>
      defineSkill({
        name: "researcher_v2",
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  it("rejects a name with spaces", () => {
    expect(() =>
      defineSkill({
        name: "researcher v2",
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  it("rejects an empty name", () => {
    expect(() =>
      defineSkill({
        name: "",
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  it("rejects a non-string name", () => {
    expect(() =>
      defineSkill({
        // @ts-expect-error: testing runtime validation
        name: 42,
        description: "ok",
        instructions: "ok",
      }),
    ).toThrow(/lowercase-kebab-case/);
  });

  // ─── description rejections ────────────────────────────────────────

  it("rejects an empty description", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "",
        instructions: "ok",
      }),
    ).toThrow(/description/);
  });

  it("rejects a whitespace-only description", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "   \n\t  ",
        instructions: "ok",
      }),
    ).toThrow(/description/);
  });

  it("rejects a non-string description", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        // @ts-expect-error: testing runtime validation
        description: undefined,
        instructions: "ok",
      }),
    ).toThrow(/description/);
  });

  // ─── instructions rejections ───────────────────────────────────────

  it("rejects empty instructions", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "",
      }),
    ).toThrow(/instructions/);
  });

  it("rejects whitespace-only instructions", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "\t\n   ",
      }),
    ).toThrow(/instructions/);
  });

  it("rejects missing instructions", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        // @ts-expect-error: testing runtime validation
        instructions: undefined,
      }),
    ).toThrow(/instructions/);
  });

  // ─── tools rejections ─────────────────────────────────────────────

  it("rejects tools that isn't an array", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        // @ts-expect-error: testing runtime validation
        tools: "not-an-array",
      }),
    ).toThrow(/tools.*array/);
  });

  it("rejects an inline tool reference missing name", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [
          // @ts-expect-error: testing runtime validation
          { type: "inline" },
        ],
      }),
    ).toThrow(/inline.*name/);
  });

  it("rejects an inline tool reference with empty name", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [{ type: "inline", name: "" }],
      }),
    ).toThrow(/inline.*name/);
  });

  it("rejects an mcp tool reference missing server", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [
          // @ts-expect-error: testing runtime validation
          { type: "mcp" },
        ],
      }),
    ).toThrow(/mcp.*server/);
  });

  it("rejects an mcp tool reference with non-array 'tools'", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [
          // @ts-expect-error: testing runtime validation
          { type: "mcp", server: "s", tools: "x" },
        ],
      }),
    ).toThrow(/mcp.*tools.*array/);
  });

  it("rejects an agent tool reference missing agentId", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [
          // @ts-expect-error: testing runtime validation
          { type: "agent" },
        ],
      }),
    ).toThrow(/agent.*agentId/);
  });

  it("rejects a tool reference with unknown type", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [
          // @ts-expect-error: testing runtime validation
          { type: "weird", name: "x" },
        ],
      }),
    ).toThrow(/unknown type/);
  });

  it("rejects a tool reference that is null", () => {
    expect(() =>
      defineSkill({
        name: "ok",
        description: "ok",
        instructions: "ok",
        tools: [
          // @ts-expect-error: testing runtime validation
          null,
        ],
      }),
    ).toThrow(/valid ToolReference/);
  });
});
