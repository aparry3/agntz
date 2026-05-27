import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent.js";
import { NamespaceGrantError } from "../src/errors.js";
import { createRunner } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import type { GenerateTextOptions, GenerateTextResult, ModelProvider } from "../src/types.js";

class MockModelProvider implements ModelProvider {
  public calls: GenerateTextOptions[] = [];

  constructor(private readonly responses: GenerateTextResult[]) {}

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.calls.push(options);
    return this.responses[this.calls.length - 1] ?? this.responses[this.responses.length - 1];
  }
}

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

describe("runtime namespace context grants", () => {
  it("normalizes first-class context grants and exposes them to tools", async () => {
    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [{ id: "tc_1", name: "inspect_context", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      { text: "done", usage, finishReason: "stop" },
    ]);

    const inspect = defineTool({
      name: "inspect_context",
      description: "Inspect context grants",
      input: z.object({}),
      async execute(_input, ctx) {
        return { context: ctx.context };
      },
    });

    const runner = createRunner({ modelProvider: provider, tools: [inspect] });
    runner.registerAgent(defineAgent({
      id: "agent",
      name: "Agent",
      systemPrompt: "Use tools.",
      model: { provider: "openai", name: "test" },
      tools: [{ type: "inline", name: "inspect_context" }],
    }));

    const result = await runner.invoke("agent", "go", {
      context: ["app/user/u_123", "app/user/u_123", "app/org/acme"],
    });

    expect(result.toolCalls[0].output).toEqual({
      context: ["app/user/u_123", "app/org/acme"],
    });
  });

  it("rejects malformed context before the model is called", async () => {
    const provider = new MockModelProvider([{ text: "never", usage, finishReason: "stop" }]);
    const runner = createRunner({ modelProvider: provider });
    runner.registerAgent(defineAgent({
      id: "agent",
      name: "Agent",
      systemPrompt: "No tools.",
      model: { provider: "openai", name: "test" },
    }));

    await expect(
      runner.invoke("agent", "go", { context: ["app//bad"] }),
    ).rejects.toThrow(NamespaceGrantError);
    expect(provider.calls).toHaveLength(0);
  });
});
