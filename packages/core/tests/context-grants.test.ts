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

  it("rejects grants that violate configured namespace security policy", async () => {
    const provider = new MockModelProvider([{ text: "never", usage, finishReason: "stop" }]);
    const runner = createRunner({
      modelProvider: provider,
      namespacePolicy: {
        protectedNamespaces: [{ namespace: "gymtext/private/users" }],
      },
    });
    runner.registerAgent(defineAgent({
      id: "agent",
      name: "Agent",
      systemPrompt: "No tools.",
      model: { provider: "openai", name: "test" },
    }));

    await expect(
      runner.invoke("agent", "go", { context: ["gymtext"] }),
    ).rejects.toThrow(NamespaceGrantError);
    expect(provider.calls).toHaveLength(0);

    await expect(
      runner.invoke("agent", "go", { context: ["gymtext/private/users/u_123"] }),
    ).resolves.toMatchObject({ output: "never" });
  });

  it("inherits context grants through tool-driven child invocations", async () => {
    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [{ id: "parent_tc", name: "call_child", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      {
        text: "",
        toolCalls: [{ id: "child_tc", name: "inspect_context", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      { text: "child done", usage, finishReason: "stop" },
      { text: "parent done", usage, finishReason: "stop" },
    ]);

    const inspect = defineTool({
      name: "inspect_context",
      description: "Inspect context grants",
      input: z.object({}),
      async execute(_input, ctx) {
        return { context: ctx.context };
      },
    });

    const callChild = defineTool({
      name: "call_child",
      description: "Invoke a child agent",
      input: z.object({}),
      async execute(_input, ctx) {
        const result = await ctx.invoke("child", "inspect");
        return result.toolCalls[0].output;
      },
    });

    const runner = createRunner({ modelProvider: provider, tools: [inspect, callChild] });
    runner.registerAgent(defineAgent({
      id: "parent",
      name: "Parent",
      systemPrompt: "Call child.",
      model: { provider: "openai", name: "test" },
      tools: [{ type: "inline", name: "call_child" }],
    }));
    runner.registerAgent(defineAgent({
      id: "child",
      name: "Child",
      systemPrompt: "Inspect.",
      model: { provider: "openai", name: "test" },
      tools: [{ type: "inline", name: "inspect_context" }],
    }));

    const result = await runner.invoke("parent", "go", {
      context: ["app/user/u_123"],
    });

    expect(result.toolCalls[0].output).toEqual({
      context: ["app/user/u_123"],
    });
  });

  it("allows child invocations to narrow grants and rejects widening", async () => {
    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [
          { id: "narrow_tc", name: "call_child_narrow", args: {} },
          { id: "wide_tc", name: "call_child_wide", args: {} },
        ],
        usage,
        finishReason: "tool-calls",
      },
      {
        text: "",
        toolCalls: [{ id: "child_tc", name: "inspect_context", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      { text: "child done", usage, finishReason: "stop" },
      { text: "parent done", usage, finishReason: "stop" },
    ]);

    const inspect = defineTool({
      name: "inspect_context",
      description: "Inspect context grants",
      input: z.object({}),
      async execute(_input, ctx) {
        return { context: ctx.context };
      },
    });

    const callChildNarrow = defineTool({
      name: "call_child_narrow",
      description: "Invoke a child agent with narrowed grants",
      input: z.object({}),
      async execute(_input, ctx) {
        const result = await ctx.invoke("child", "inspect", {
          context: ["app/user/u_123/session/s_1"],
        });
        return result.toolCalls[0].output;
      },
    });

    const callChildWide = defineTool({
      name: "call_child_wide",
      description: "Invoke a child agent with widened grants",
      input: z.object({}),
      async execute(_input, ctx) {
        return ctx.invoke("child", "inspect", {
          context: ["app/user/u_456"],
        });
      },
    });

    const runner = createRunner({
      modelProvider: provider,
      tools: [inspect, callChildNarrow, callChildWide],
    });
    runner.registerAgent(defineAgent({
      id: "parent",
      name: "Parent",
      systemPrompt: "Call child.",
      model: { provider: "openai", name: "test" },
      tools: [
        { type: "inline", name: "call_child_narrow" },
        { type: "inline", name: "call_child_wide" },
      ],
    }));
    runner.registerAgent(defineAgent({
      id: "child",
      name: "Child",
      systemPrompt: "Inspect.",
      model: { provider: "openai", name: "test" },
      tools: [{ type: "inline", name: "inspect_context" }],
    }));

    const result = await runner.invoke("parent", "go", {
      context: ["app/user/u_123"],
    });

    expect(result.toolCalls[0].output).toEqual({
      context: ["app/user/u_123/session/s_1"],
    });
    expect(result.toolCalls[1].error).toMatch(/not within parent context/);
  });
});
