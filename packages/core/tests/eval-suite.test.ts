import { describe, expect, it, vi } from "vitest";
import { runEvalSuite } from "../src/eval-suite.js";
import type { EvalSuite, ModelProvider } from "../src/types.js";

function makeSuite(overrides: Partial<EvalSuite> = {}): EvalSuite {
  return {
    id: "suite_1",
    agentId: "agent_1",
    name: "Suite",
    rubric: "Answer accurately.",
    passThreshold: 0.8,
    cases: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("runEvalSuite", () => {
  it("runs deterministic assertions against structured output", async () => {
    const suite = makeSuite({
      cases: [
        {
          id: "case_1",
          name: "structured output",
          input: { text: "hello" },
          assertions: [
            { type: "field-exists", path: "sentiment" },
            { type: "field-equals", path: "sentiment", value: "positive" },
            { type: "numeric-range", path: "score", value: { min: 0.8, max: 1 } },
          ],
        },
      ],
    });

    const result = await runEvalSuite(suite, {
      execute: async () => ({ output: { sentiment: "positive", score: 0.9 } }),
    });

    expect(result.summary).toMatchObject({ total: 1, passed: 1, failed: 0, score: 1 });
    expect(result.caseResults[0].assertions).toHaveLength(3);
  });

  it("uses the model provider for LLM rubric assertions", async () => {
    const suite = makeSuite({
      cases: [
        {
          id: "case_1",
          name: "judge",
          input: "reset my password",
          assertions: [{ type: "llm-rubric", value: "Includes clear reset steps." }],
        },
      ],
    });
    const modelProvider: ModelProvider = {
      generateText: vi.fn(async () => ({
        text: JSON.stringify({ score: 0.95, reason: "Clear and complete" }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      })),
    };

    const result = await runEvalSuite(suite, {
      execute: async () => "Go to settings and request a password reset email.",
      modelProvider,
    });

    expect(result.summary.passed).toBe(1);
    expect(modelProvider.generateText).toHaveBeenCalledOnce();
    expect(result.caseResults[0].assertions[0]).toMatchObject({
      type: "llm-rubric",
      passed: true,
      score: 0.95,
    });
  });
});
