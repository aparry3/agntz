import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { defineTool } from "../src/tool.js";
import { z } from "zod";
import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  AgntzError,
  InvalidAgentRefError,
  InvocationCancelledError,
  MaxStepsExceededError,
  TokenBudgetExceededError,
} from "../src/errors.js";
import type { ModelProvider, GenerateTextOptions, GenerateTextResult } from "../src/types.js";

class MockModelProvider implements ModelProvider {
  private responses: GenerateTextResult[];
  private callIndex = 0;

  constructor(responses: GenerateTextResult | GenerateTextResult[]) {
    this.responses = Array.isArray(responses) ? responses : [responses];
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const response = this.responses[this.callIndex] ?? this.responses[this.responses.length - 1];
    this.callIndex++;
    return response;
  }
}

function mockResponse(text: string): GenerateTextResult {
  return {
    text,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: "stop",
  };
}

function toolCallResponse(name: string, args: unknown = {}): GenerateTextResult {
  return {
    text: "",
    toolCalls: [{ id: `call_${Date.now()}`, name, args }],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: "tool-calls",
  };
}

describe("Typed Errors", () => {
  it("throws AgentNotFoundError for unknown agent", async () => {
    const runner = createRunner({ modelProvider: new MockModelProvider(mockResponse("")) });

    try {
      await runner.invoke("nonexistent", "hi");
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AgentNotFoundError);
      expect(err).toBeInstanceOf(AgntzError);
      expect((err as AgentNotFoundError).agentId).toBe("nonexistent");
      expect((err as AgentNotFoundError).code).toBe("AGENT_NOT_FOUND");
    }
  });

  it("throws InvocationCancelledError when signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const provider = new MockModelProvider(mockResponse("won't get here"));
    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "test",
        name: "Test",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
      })
    );

    try {
      await runner.invoke("test", "hi", { signal: controller.signal });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvocationCancelledError);
      expect((err as InvocationCancelledError).code).toBe("INVOCATION_CANCELLED");
    }
  });

  it("all errors extend AgntzError", () => {
    const err = new AgentNotFoundError("test");
    expect(err instanceof AgntzError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err.code).toBe("AGENT_NOT_FOUND");
    expect(err.name).toBe("AgentNotFoundError");
  });

  it("MaxStepsExceededError includes agent and step info", () => {
    const err = new MaxStepsExceededError("my-agent", 5);
    expect(err.agentId).toBe("my-agent");
    expect(err.maxSteps).toBe(5);
    expect(err.code).toBe("MAX_STEPS_EXCEEDED");
    expect(err.message).toContain("my-agent");
    expect(err.message).toContain("5");
  });

  it("AgentVersionNotFoundError exposes agentId and version", () => {
    const err = new AgentVersionNotFoundError("reviewer", "2026-05-17T15:30:00.000Z");
    expect(err).toBeInstanceOf(AgntzError);
    expect(err.code).toBe("AGENT_VERSION_NOT_FOUND");
    expect(err.name).toBe("AgentVersionNotFoundError");
    expect(err.agentId).toBe("reviewer");
    expect(err.version).toBe("2026-05-17T15:30:00.000Z");
    expect(err.message).toContain("reviewer");
    expect(err.message).toContain("2026-05-17T15:30:00.000Z");
  });

  it("InvalidAgentRefError carries the input verbatim", () => {
    const err = new InvalidAgentRefError("foo@bogus", "version must be ISO");
    expect(err).toBeInstanceOf(AgntzError);
    expect(err.code).toBe("INVALID_AGENT_REF");
    expect(err.name).toBe("InvalidAgentRefError");
    expect(err.input).toBe("foo@bogus");
    expect(err.message).toContain("foo@bogus");
    expect(err.message).toContain("version must be ISO");
  });

  it("TokenBudgetExceededError exposes agentId, budget, and usage", () => {
    const err = new TokenBudgetExceededError("my-agent", 100, 142);
    expect(err).toBeInstanceOf(AgntzError);
    expect(err.code).toBe("TOKEN_BUDGET_EXCEEDED");
    expect(err.name).toBe("TokenBudgetExceededError");
    expect(err.agentId).toBe("my-agent");
    expect(err.tokenBudget).toBe(100);
    expect(err.tokensUsed).toBe(142);
    expect(err.message).toContain("my-agent");
    expect(err.message).toContain("142/100");
  });
});

describe("Resource limits", () => {
  // A mock provider that always returns a tool call (looping forever) and
  // reports a fixed usage per call. Lets us hit token budgets deterministically.
  class LoopingProvider implements ModelProvider {
    public lastOptions?: GenerateTextOptions;
    constructor(private tokensPerCall: number, private toolName: string | null = "noop") {}
    async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
      this.lastOptions = options;
      const half = Math.floor(this.tokensPerCall / 2);
      return {
        text: "",
        toolCalls: this.toolName
          ? [{ id: `c_${Date.now()}_${Math.random()}`, name: this.toolName, args: {} }]
          : undefined,
        usage: { promptTokens: half, completionTokens: this.tokensPerCall - half, totalTokens: this.tokensPerCall },
        finishReason: this.toolName ? "tool-calls" : "stop",
      };
    }
  }

  const noopTool = defineTool({
    name: "noop",
    description: "no-op tool used to keep the loop alive in tests",
    input: z.object({}),
    async execute() {
      return "ok";
    },
  });

  function registerLoopAgent(runner: ReturnType<typeof createRunner>, opts: { maxSteps?: number; tokenBudget?: number } = {}) {
    runner.registerAgent(
      defineAgent({
        id: "looper",
        name: "Looper",
        systemPrompt: "loop",
        model: { provider: "openai", name: "gpt-5.4" },
        tools: [{ type: "inline", name: "noop" }],
        ...opts,
      }),
    );
  }

  it("throws TokenBudgetExceededError when cumulative usage hits InvokeOptions.tokenBudget", async () => {
    const provider = new LoopingProvider(40);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    registerLoopAgent(runner);

    try {
      await runner.invoke("looper", "go", { tokenBudget: 50, maxSteps: 99 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenBudgetExceededError);
      const tbe = err as TokenBudgetExceededError;
      expect(tbe.tokenBudget).toBe(50);
      expect(tbe.tokensUsed).toBeGreaterThanOrEqual(50);
      expect(tbe.agentId).toBe("looper");
    }
  });

  it("throws TokenBudgetExceededError when budget is set on the AgentDefinition", async () => {
    const provider = new LoopingProvider(30);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    registerLoopAgent(runner, { tokenBudget: 40, maxSteps: 99 });

    await expect(runner.invoke("looper", "go")).rejects.toBeInstanceOf(TokenBudgetExceededError);
  });

  it("caller-tightens-only: InvokeOptions.tokenBudget below agent.tokenBudget wins", async () => {
    const provider = new LoopingProvider(20);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    registerLoopAgent(runner, { tokenBudget: 1000, maxSteps: 99 });

    try {
      await runner.invoke("looper", "go", { tokenBudget: 25 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenBudgetExceededError);
      // The effective budget is min(agent=1000, options=25) = 25, not 1000.
      expect((err as TokenBudgetExceededError).tokenBudget).toBe(25);
    }
  });

  it("caller-tightens-only: InvokeOptions.tokenBudget above agent.tokenBudget is clamped", async () => {
    const provider = new LoopingProvider(20);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    registerLoopAgent(runner, { tokenBudget: 30, maxSteps: 99 });

    try {
      // Caller asks for 10000, but agent caps at 30 — effective should be 30.
      await runner.invoke("looper", "go", { tokenBudget: 10000 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenBudgetExceededError);
      expect((err as TokenBudgetExceededError).tokenBudget).toBe(30);
    }
  });

  it("does not throw when totalUsage never reaches the budget", async () => {
    // Provider returns no tool calls on the first turn → loop terminates after 1 step.
    const provider = new LoopingProvider(10, null);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    registerLoopAgent(runner, { tokenBudget: 1000 });

    const result = await runner.invoke("looper", "hi");
    expect(result.usage.totalTokens).toBe(10);
  });

  it("agent.maxSteps caps caller's InvokeOptions.maxSteps (caller-tightens-only)", async () => {
    const provider = new LoopingProvider(5);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    registerLoopAgent(runner, { maxSteps: 2 });

    // Caller asks for 999 steps, but agent caps at 2. With a looping provider
    // and no tokenBudget, invoke() exits the while loop quietly at step=2 with
    // empty output. We assert that — the loop didn't run more than the cap.
    const result = await runner.invoke("looper", "go", { maxSteps: 999 });
    // 2 model calls × 5 tokens each = 10
    expect(result.usage.totalTokens).toBeLessThanOrEqual(10);
  });

  it("passes maxTokens from ModelConfig through to the model provider", async () => {
    const provider = new LoopingProvider(5, null);
    const runner = createRunner({ modelProvider: provider, tools: [noopTool] });
    runner.registerAgent(
      defineAgent({
        id: "capped",
        name: "Capped",
        systemPrompt: "hi",
        model: { provider: "openai", name: "gpt-5.4", maxTokens: 1234 },
      }),
    );

    await runner.invoke("capped", "go");
    expect(provider.lastOptions?.maxTokens).toBe(1234);
  });
});
