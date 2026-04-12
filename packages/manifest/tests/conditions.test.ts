import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../src/conditions.js";

describe("evaluateCondition", () => {
  it("evaluates truthiness", () => {
    expect(evaluateCondition("{{feedback}}", { feedback: "good" })).toBe(true);
    expect(evaluateCondition("{{feedback}}", { feedback: null })).toBe(false);
    expect(evaluateCondition("{{feedback}}", { feedback: "" })).toBe(false);
    expect(evaluateCondition("{{feedback}}", {})).toBe(false);
  });

  it("evaluates equality", () => {
    expect(evaluateCondition("{{lang}} == en", { lang: "en" })).toBe(true);
    expect(evaluateCondition("{{lang}} == en", { lang: "fr" })).toBe(false);
  });

  it("evaluates inequality", () => {
    expect(evaluateCondition("{{lang}} != en", { lang: "fr" })).toBe(true);
    expect(evaluateCondition("{{lang}} != en", { lang: "en" })).toBe(false);
  });

  it("evaluates boolean equality", () => {
    expect(evaluateCondition("{{approved}} == true", { approved: true })).toBe(true);
    expect(evaluateCondition("{{approved}} == true", { approved: false })).toBe(false);
  });

  it("evaluates numeric comparisons", () => {
    expect(evaluateCondition("{{score}} >= 0.8", { score: 0.9 })).toBe(true);
    expect(evaluateCondition("{{score}} >= 0.8", { score: 0.7 })).toBe(false);
    expect(evaluateCondition("{{score}} > 0.8", { score: 0.9 })).toBe(true);
    expect(evaluateCondition("{{score}} < 0.8", { score: 0.5 })).toBe(true);
    expect(evaluateCondition("{{score}} <= 0.8", { score: 0.8 })).toBe(true);
  });

  it("evaluates compound AND", () => {
    expect(
      evaluateCondition("{{score}} >= 0.8 && {{approved}} == true", {
        score: 0.9,
        approved: true,
      })
    ).toBe(true);
    expect(
      evaluateCondition("{{score}} >= 0.8 && {{approved}} == true", {
        score: 0.9,
        approved: false,
      })
    ).toBe(false);
  });

  it("evaluates compound OR", () => {
    expect(
      evaluateCondition("{{score}} >= 0.8 || {{override}} == true", {
        score: 0.5,
        override: true,
      })
    ).toBe(true);
    expect(
      evaluateCondition("{{score}} >= 0.8 || {{override}} == true", {
        score: 0.5,
        override: false,
      })
    ).toBe(false);
  });
});
