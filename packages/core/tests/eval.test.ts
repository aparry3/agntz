import { describe, it, expect, vi } from "vitest";
import { runEval } from "../src/eval.js";
import type { AgentDefinition, InvokeResult, EvalTestCase } from "../src/types.js";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function makeAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    systemPrompt: "You are a test agent.",
    model: { provider: "openai", name: "gpt-4o-mini" },
    ...overrides,
  };
}

function makeInvokeResult(output: string): InvokeResult {
  return {
    output,
    invocationId: "inv_test",
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    duration: 100,
    model: "openai/gpt-4o-mini",
  };
}

function mockInvoke(responses: Record<string, string>) {
  return vi.fn(async (_agentId: string, input: string) => {
    const output = responses[input] ?? "Default response";
    return makeInvokeResult(output);
  });
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("runEval", () => {
  it("returns empty result for agent with no test cases", async () => {
    const agent = makeAgent();
    const result = await runEval(agent, {
      invoke: mockInvoke({}),
    });

    expect(result.agentId).toBe("test-agent");
    expect(result.testCases).toHaveLength(0);
    expect(result.summary.total).toBe(0);
    expect(result.summary.score).toBe(1);
  });

  it("runs test cases from agent.eval.testCases", async () => {
    const agent = makeAgent({
      eval: {
        testCases: [
          {
            name: "greeting",
            input: "Hello",
            assertions: [{ type: "contains", value: "hello" }],
          },
        ],
      },
    });

    const invoke = mockInvoke({ Hello: "Hello there!" });
    const result = await runEval(agent, { invoke });

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].name).toBe("greeting");
    expect(result.testCases[0].passed).toBe(true);
    expect(result.summary.passed).toBe(1);
  });

  it("overrides test cases via options", async () => {
    const agent = makeAgent({
      eval: {
        testCases: [{ input: "original", assertions: [] }],
      },
    });

    const overrideCases: EvalTestCase[] = [
      {
        name: "override",
        input: "Hello",
        assertions: [{ type: "contains", value: "hello" }],
      },
    ];

    const invoke = mockInvoke({ Hello: "Hello world!" });
    const result = await runEval(agent, { invoke, testCases: overrideCases });

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].name).toBe("override");
  });

  it("assigns default names to unnamed test cases", async () => {
    const agent = makeAgent({
      eval: {
        testCases: [
          { input: "a", assertions: [] },
          { input: "b", assertions: [] },
        ],
      },
    });

    const invoke = mockInvoke({});
    const result = await runEval(agent, { invoke });

    expect(result.testCases[0].name).toBe("test_1");
    expect(result.testCases[1].name).toBe("test_2");
  });

  it("calls onProgress callback", async () => {
    const agent = makeAgent({
      eval: {
        testCases: [
          { input: "a", assertions: [] },
          { input: "b", assertions: [] },
        ],
      },
    });

    const progress: Array<[number, number, string]> = [];
    const invoke = mockInvoke({});
    await runEval(agent, {
      invoke,
      onProgress: (completed, total, name) => progress.push([completed, total, name]),
    });

    expect(progress).toEqual([
      [0, 2, "test_1"],
      [1, 2, "test_2"],
      [2, 2, "done"],
    ]);
  });

  it("handles invoke errors gracefully", async () => {
    const agent = makeAgent({
      eval: {
        testCases: [{ name: "failing", input: "crash", assertions: [] }],
      },
    });

    const invoke = vi.fn(async () => {
      throw new Error("Model exploded");
    });

    const result = await runEval(agent, { invoke });

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].passed).toBe(false);
    expect(result.testCases[0].score).toBe(0);
    expect(result.testCases[0].assertions[0].reason).toContain("Model exploded");
  });

  it("passes context as extraContext to invoke", async () => {
    const agent = makeAgent({
      eval: {
        testCases: [
          {
            input: "summarize",
            context: "The sky is blue.",
            assertions: [{ type: "contains", value: "blue" }],
          },
        ],
      },
    });

    const invoke = vi.fn(async (_: string, _input: string) =>
      makeInvokeResult("The sky is blue and beautiful.")
    );

    await runEval(agent, { invoke });

    expect(invoke).toHaveBeenCalledWith("test-agent", "summarize", {
      extraContext: "The sky is blue.",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Assertion Tests
// ═══════════════════════════════════════════════════════════════════

describe("assertions", () => {
  const invoke = mockInvoke({});
  const makeEvalAgent = (assertions: EvalTestCase["assertions"], response: string) => {
    return {
      agent: makeAgent({
        eval: {
          testCases: [{ input: "test", assertions }],
        },
      }),
      invoke: vi.fn(async () => makeInvokeResult(response)),
    };
  };

  describe("contains", () => {
    it("passes when output contains the value (case-insensitive)", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "contains", value: "HELLO" }],
        "hello world"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(true);
    });

    it("fails when output does not contain the value", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "contains", value: "goodbye" }],
        "hello world"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(false);
    });
  });

  describe("not-contains", () => {
    it("passes when output does not contain the value", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "not-contains", value: "error" }],
        "everything is fine"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(true);
    });

    it("fails when output contains the value", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "not-contains", value: "error" }],
        "there was an error"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(false);
    });
  });

  describe("regex", () => {
    it("passes when output matches the pattern", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "regex", value: "\\d{3}-\\d{4}" }],
        "Call 555-1234"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(true);
    });

    it("fails when output does not match", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "regex", value: "^\\d+$" }],
        "not a number"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(false);
    });

    it("handles invalid regex gracefully", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "regex", value: "[invalid" }],
        "anything"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(false);
      expect(result.testCases[0].assertions[0].reason).toContain("Invalid regex");
    });
  });

  describe("json-schema", () => {
    it("passes when output matches the schema", async () => {
      const { agent, invoke } = makeEvalAgent(
        [
          {
            type: "json-schema",
            value: {
              type: "object",
              required: ["name", "age"],
              properties: {
                name: { type: "string" },
                age: { type: "number" },
              },
            },
          },
        ],
        '{"name": "Aaron", "age": 30}'
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(true);
    });

    it("fails when output is missing required properties", async () => {
      const { agent, invoke } = makeEvalAgent(
        [
          {
            type: "json-schema",
            value: {
              type: "object",
              required: ["name", "age"],
              properties: {
                name: { type: "string" },
                age: { type: "number" },
              },
            },
          },
        ],
        '{"name": "Aaron"}'
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(false);
      expect(result.testCases[0].assertions[0].reason).toContain("age");
    });

    it("fails when output is not valid JSON", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "json-schema", value: { type: "object" } }],
        "not json at all"
      );
      const result = await runEval(agent, { invoke });
      expect(result.testCases[0].assertions[0].passed).toBe(false);
      expect(result.testCases[0].assertions[0].reason).toContain("not valid JSON");
    });
  });

  describe("weighted scoring", () => {
    it("calculates weighted average score", async () => {
      const agent = makeAgent({
        eval: {
          passThreshold: 0.5,
          testCases: [
            {
              input: "test",
              assertions: [
                { type: "contains", value: "hello", weight: 3 },
                { type: "contains", value: "missing", weight: 1 },
              ],
            },
          ],
        },
      });

      const invoke = vi.fn(async () => makeInvokeResult("hello world"));
      const result = await runEval(agent, { invoke });

      // weight 3 passes (score 1), weight 1 fails (score 0)
      // weighted score = (3*1 + 1*0) / (3+1) = 0.75
      expect(result.testCases[0].score).toBe(0.75);
      expect(result.testCases[0].passed).toBe(true); // 0.75 >= 0.5 threshold
    });
  });

  describe("semantic-similar (no model)", () => {
    it("uses Jaccard similarity as fallback", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "semantic-similar", value: "hello world" }],
        "hello beautiful world"
      );
      const result = await runEval(agent, { invoke });

      // Some overlap between words
      expect(result.testCases[0].assertions[0].score).toBeGreaterThan(0);
      expect(result.testCases[0].assertions[0].reason).toContain("Jaccard");
    });
  });

  describe("llm-rubric (no model)", () => {
    it("fails gracefully without a model provider", async () => {
      const { agent, invoke } = makeEvalAgent(
        [{ type: "llm-rubric", value: "Be friendly" }],
        "hello"
      );
      const result = await runEval(agent, { invoke });

      expect(result.testCases[0].assertions[0].passed).toBe(false);
      expect(result.testCases[0].assertions[0].reason).toContain("modelProvider");
    });
  });

  describe("llm-rubric (with mock model)", () => {
    it("uses model provider to judge output", async () => {
      const agent = makeAgent({
        eval: {
          testCases: [
            {
              input: "test",
              assertions: [{ type: "llm-rubric", value: "Be friendly and warm" }],
            },
          ],
        },
      });

      const invoke = vi.fn(async () => makeInvokeResult("Hello friend!"));
      const modelProvider = {
        generateText: vi.fn(async () => ({
          text: '{"score": 0.9, "reason": "Very friendly tone"}',
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          finishReason: "stop",
        })),
      };

      const result = await runEval(agent, { invoke, modelProvider });

      expect(result.testCases[0].assertions[0].passed).toBe(true);
      expect(result.testCases[0].assertions[0].score).toBe(0.9);
      expect(result.testCases[0].assertions[0].reason).toBe("Very friendly tone");
    });
  });

  describe("expectedOutput fallback", () => {
    it("uses contains assertion when expectedOutput is set with no assertions", async () => {
      const agent = makeAgent({
        eval: {
          testCases: [
            { input: "test", expectedOutput: "world" },
          ],
        },
      });

      const invoke = vi.fn(async () => makeInvokeResult("hello world"));
      const result = await runEval(agent, { invoke });

      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].assertions[0].type).toBe("contains");
    });
  });
});

describe("runner.eval()", () => {
  it("integrates with Runner class", async () => {
    // This is tested via the runner integration — import createRunner
    const { createRunner, defineAgent } = await import("../src/index.js");

    const runner = createRunner({
      modelProvider: {
        async generateText() {
          return {
            text: "Hello, welcome!",
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: "stop",
          };
        },
      },
    });

    runner.registerAgent(
      defineAgent({
        id: "greeter",
        name: "Greeter",
        systemPrompt: "Greet users warmly.",
        model: { provider: "openai", name: "gpt-4o-mini" },
        eval: {
          testCases: [
            {
              name: "basic-greeting",
              input: "Hi",
              assertions: [{ type: "contains", value: "hello" }],
            },
            {
              name: "has-welcome",
              input: "Hey",
              assertions: [{ type: "contains", value: "welcome" }],
            },
          ],
        },
      })
    );

    const result = await runner.eval("greeter");

    expect(result.agentId).toBe("greeter");
    expect(result.testCases).toHaveLength(2);
    expect(result.summary.total).toBe(2);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.score).toBe(1);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
