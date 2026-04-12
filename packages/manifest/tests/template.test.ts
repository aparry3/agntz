import { describe, it, expect } from "vitest";
import { interpolate, renderTemplate, resolvePath, isTruthy } from "../src/template.js";

describe("resolvePath", () => {
  it("resolves top-level properties", () => {
    expect(resolvePath({ name: "Alice" }, "name")).toBe("Alice");
  });

  it("resolves nested properties", () => {
    expect(resolvePath({ agent: { output: { score: 0.9 } } }, "agent.output.score")).toBe(0.9);
  });

  it("returns undefined for missing paths", () => {
    expect(resolvePath({ a: 1 }, "b")).toBeUndefined();
    expect(resolvePath({ a: { b: 1 } }, "a.c")).toBeUndefined();
  });

  it("returns undefined when traversing null", () => {
    expect(resolvePath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("interpolate", () => {
  it("replaces simple variables", () => {
    expect(interpolate("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("replaces nested variables", () => {
    expect(interpolate("Score: {{agent.score}}", { agent: { score: 42 } })).toBe("Score: 42");
  });

  it("renders null/undefined as empty string", () => {
    expect(interpolate("Value: {{missing}}", {})).toBe("Value: ");
  });

  it("handles objects by JSON stringifying", () => {
    const state = { data: { a: 1, b: 2 } };
    expect(interpolate("{{data}}", state)).toBe('{"a":1,"b":2}');
  });

  it("handles multiple variables", () => {
    expect(interpolate("{{a}} and {{b}}", { a: "X", b: "Y" })).toBe("X and Y");
  });

  it("does not interpolate #if blocks", () => {
    const result = interpolate("{{#if x}}yes{{/if}}", { x: true });
    expect(result).toContain("{{#if");
  });
});

describe("renderTemplate", () => {
  it("processes conditional blocks with truthiness", () => {
    const template = "Start {{#if feedback}}Feedback: {{feedback}}{{/if}} End";
    expect(renderTemplate(template, { feedback: "good" })).toBe("Start Feedback: good End");
    expect(renderTemplate(template, { feedback: null })).toBe("Start  End");
    expect(renderTemplate(template, {})).toBe("Start  End");
  });

  it("processes conditional blocks with equality", () => {
    const template = "{{#if lang == en}}English{{/if}}";
    expect(renderTemplate(template, { lang: "en" })).toBe("English");
    expect(renderTemplate(template, { lang: "fr" })).toBe("");
  });

  it("processes conditional blocks with inequality", () => {
    const template = "{{#if lang != en}}Not English{{/if}}";
    expect(renderTemplate(template, { lang: "fr" })).toBe("Not English");
    expect(renderTemplate(template, { lang: "en" })).toBe("");
  });

  it("handles nested conditionals", () => {
    const template = "{{#if a}}A{{#if b}}B{{/if}}{{/if}}";
    expect(renderTemplate(template, { a: true, b: true })).toBe("AB");
    expect(renderTemplate(template, { a: true, b: false })).toBe("A");
    expect(renderTemplate(template, { a: false, b: true })).toBe("");
  });

  it("interpolates variables inside conditionals", () => {
    const template = "{{#if name}}Hello {{name}}!{{/if}}";
    expect(renderTemplate(template, { name: "Alice" })).toBe("Hello Alice!");
  });
});

describe("isTruthy", () => {
  it("null/undefined are falsy", () => {
    expect(isTruthy(null)).toBe(false);
    expect(isTruthy(undefined)).toBe(false);
  });

  it("empty string is falsy", () => {
    expect(isTruthy("")).toBe(false);
  });

  it("zero is falsy", () => {
    expect(isTruthy(0)).toBe(false);
  });

  it("false is falsy", () => {
    expect(isTruthy(false)).toBe(false);
  });

  it("non-empty values are truthy", () => {
    expect(isTruthy("hello")).toBe(true);
    expect(isTruthy(1)).toBe(true);
    expect(isTruthy(true)).toBe(true);
    expect(isTruthy({})).toBe(true);
    expect(isTruthy([])).toBe(true);
  });
});
