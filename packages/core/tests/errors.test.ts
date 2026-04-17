import { describe, it, expect } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { defineTool } from "../src/tool.js";
import { z } from "zod";
import {
  AgentNotFoundError,
  AgntzError,
  InvocationCancelledError,
  MaxStepsExceededError,
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
});
