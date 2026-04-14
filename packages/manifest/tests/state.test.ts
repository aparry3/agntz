import { describe, it, expect } from "vitest";
import {
  normalizeId,
  getStateKey,
  createInitialState,
  applyInputTransform,
  applyOutputMapping,
} from "../src/state.js";

describe("normalizeId", () => {
  it("converts kebab-case to camelCase", () => {
    expect(normalizeId("my-agent-name")).toBe("myAgentName");
  });

  it("leaves already camelCase unchanged", () => {
    expect(normalizeId("myAgent")).toBe("myAgent");
  });

  it("handles single word", () => {
    expect(normalizeId("agent")).toBe("agent");
  });
});

describe("getStateKey", () => {
  it("uses explicit stateKey on step", () => {
    expect(getStateKey({ ref: "some-agent", stateKey: "custom" })).toBe("custom");
  });

  it("uses stateKey from inline agent", () => {
    expect(
      getStateKey({
        agent: { id: "some-agent", kind: "llm", stateKey: "inline-key" } as any,
      })
    ).toBe("inline-key");
  });

  it("normalizes ref id for references", () => {
    expect(getStateKey({ ref: "web-researcher" })).toBe("webResearcher");
  });

  it("normalizes inline agent id", () => {
    expect(
      getStateKey({ agent: { id: "my-inline-agent", kind: "llm" } as any })
    ).toBe("myInlineAgent");
  });
});

describe("createInitialState", () => {
  it("creates default state for string input", () => {
    expect(createInitialState("hello")).toEqual({ userQuery: "hello" });
  });

  it("creates structured state from inputSchema", () => {
    const schema = {
      query: "string",
      language: { type: "string", default: "en" },
    };
    const state = createInitialState({ query: "test" }, schema);
    expect(state).toEqual({ query: "test", language: "en" });
  });

  it("sets missing properties to null", () => {
    const schema = { query: "string", extra: "string" };
    const state = createInitialState({ query: "test" }, schema);
    expect(state).toEqual({ query: "test", extra: null });
  });
});

describe("applyInputTransform", () => {
  it("maps state to child input", () => {
    const state = { userQuery: "hello", lang: "en" };
    const transform = { query: "{{userQuery}}", language: "{{lang}}" };
    expect(applyInputTransform(transform, state, null)).toEqual({
      query: "hello",
      language: "en",
    });
  });

  it("preserves object types for simple refs", () => {
    const state = { data: { a: 1, b: 2 } };
    const transform = { input: "{{data}}" };
    expect(applyInputTransform(transform, state, null)).toEqual({
      input: { a: 1, b: 2 },
    });
  });

  it("resolves null for missing refs", () => {
    const state = {};
    const transform = { feedback: "{{reviewer.feedback}}" };
    expect(applyInputTransform(transform, state, null)).toEqual({
      feedback: null,
    });
  });

  it("returns the upstream value when no transform", () => {
    const state = { a: 1, b: 2 };
    const upstream = { passed: "through" };
    expect(applyInputTransform(undefined, state, upstream)).toEqual(upstream);
  });

  it("passes a string upstream through unchanged", () => {
    expect(applyInputTransform(undefined, {}, "hello")).toBe("hello");
  });
});

describe("applyOutputMapping", () => {
  it("maps state to output", () => {
    const state = {
      researcher: { findings: "data" },
      summarizer: { summary: "short" },
    };
    const mapping = {
      result: "{{summarizer.summary}}",
      raw: "{{researcher}}",
    };
    const output = applyOutputMapping(mapping, state);
    expect(output).toEqual({
      result: "short",
      raw: { findings: "data" },
    });
  });

  it("supports nested output objects", () => {
    const state = {
      webResearcher: "web data",
      academicResearcher: "academic data",
    };
    const mapping = {
      sources: {
        web: "{{webResearcher}}",
        academic: "{{academicResearcher}}",
      },
    };
    const output = applyOutputMapping(mapping, state);
    expect(output).toEqual({
      sources: {
        web: "web data",
        academic: "academic data",
      },
    });
  });
});
