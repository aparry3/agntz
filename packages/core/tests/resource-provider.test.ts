import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAgent } from "../src/agent.js";
import { createRunner } from "../src/runner.js";
import { defineTool } from "../src/tool.js";
import type {
  GenerateTextOptions,
  GenerateTextResult,
  ModelProvider,
  ResourceProvider,
  ResourceToolContext,
  ToolContext,
} from "../src/types.js";

class MockModelProvider implements ModelProvider {
  public calls: GenerateTextOptions[] = [];

  constructor(private readonly responses: GenerateTextResult[]) {}

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.calls.push(options);
    return this.responses[this.calls.length - 1] ?? this.responses[this.responses.length - 1];
  }
}

const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };

function fakeProvider(seen: ResourceToolContext[] = []): ResourceProvider {
  return {
    defaultMode: "read-write",
    async getContext(ctx) {
      seen.push(ctx);
      return `grants=${ctx.grants.join(",")}; mode=${ctx.mode}`;
    },
    tools() {
      return [
        {
          name: "read",
          description: "Read from the resource",
          input: z.object({}),
          async execute(_input, ctx) {
            seen.push(ctx);
            return {
              resourceName: ctx.resourceName,
              kind: ctx.kind,
              mode: ctx.mode,
              grants: ctx.grants,
              marker: ctx.config.marker,
            };
          },
        },
        {
          name: "write",
          description: "Write to the resource",
          mode: "read-write",
          input: z.object({}),
          async execute(_input, ctx) {
            seen.push(ctx);
            return { mode: ctx.mode };
          },
        },
      ];
    },
  };
}

describe("resource providers", () => {
  it("fails fast when an agent declares a resource kind with no provider", () => {
    const runner = createRunner();
    expect(() =>
      runner.registerAgent(defineAgent({
        id: "agent",
        name: "Agent",
        systemPrompt: "Use resources.",
        model: { provider: "openai", name: "test" },
        resources: {
          memory: { kind: "memory" },
        },
      })),
    ).toThrow(/no ResourceProvider is wired/);
  });

  it("registers provider tools with deterministic resource-prefixed names", async () => {
    const seen: ResourceToolContext[] = [];
    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [{ id: "tc_1", name: "memory_read", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      { text: "done", usage, finishReason: "stop" },
    ]);
    const runner = createRunner({
      modelProvider: provider,
      resources: { fake: fakeProvider(seen) },
    });
    runner.registerAgent(defineAgent({
      id: "agent",
      name: "Agent",
      systemPrompt: "Use resources.",
      model: { provider: "openai", name: "test" },
      resources: {
        memory: { kind: "fake", mode: "read-write", marker: "m1" },
      },
    }));

    const result = await runner.invoke("agent", "go", {
      context: ["app/user/u_123"],
    });

    expect(provider.calls[0].tools?.map((t) => t.name).sort()).toEqual([
      "memory_read",
      "memory_write",
    ]);
    expect(result.toolCalls[0].output).toEqual({
      resourceName: "memory",
      kind: "fake",
      mode: "read-write",
      grants: ["app/user/u_123"],
      marker: "m1",
    });
    expect(provider.calls[0].messages.some((m) =>
      m.role === "system" && m.content.includes("## Resource: memory"),
    )).toBe(true);
  });

  it("omits read-write provider tools when the resource is read-only", async () => {
    const provider = new MockModelProvider([{ text: "done", usage, finishReason: "stop" }]);
    const runner = createRunner({
      modelProvider: provider,
      resources: { fake: fakeProvider() },
    });
    runner.registerAgent(defineAgent({
      id: "agent",
      name: "Agent",
      systemPrompt: "Use resources.",
      model: { provider: "openai", name: "test" },
      resources: {
        memory: { kind: "fake", mode: "read" },
      },
    }));

    await runner.invoke("agent", "go");

    expect(provider.calls[0].tools?.map((t) => t.name)).toEqual(["memory_read"]);
  });

  it("clamps child resource mode to the parent effective mode", async () => {
    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [{ id: "parent_tc", name: "call_child", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      {
        text: "",
        toolCalls: [{ id: "child_tc", name: "memory_read", args: {} }],
        usage,
        finishReason: "tool-calls",
      },
      { text: "child done", usage, finishReason: "stop" },
      { text: "parent done", usage, finishReason: "stop" },
    ]);
    const callChild = defineTool({
      name: "call_child",
      description: "Call child",
      input: z.object({}),
      async execute(_input, ctx: ToolContext) {
        const result = await ctx.invoke("child", "go");
        return result.toolCalls[0].output;
      },
    });

    const runner = createRunner({
      modelProvider: provider,
      resources: { fake: fakeProvider() },
      tools: [callChild],
    });
    runner.registerAgent(defineAgent({
      id: "parent",
      name: "Parent",
      systemPrompt: "Call child.",
      model: { provider: "openai", name: "test" },
      tools: [{ type: "inline", name: "call_child" }],
      resources: {
        memory: { kind: "fake", mode: "read" },
      },
    }));
    runner.registerAgent(defineAgent({
      id: "child",
      name: "Child",
      systemPrompt: "Use memory.",
      model: { provider: "openai", name: "test" },
      resources: {
        memory: { kind: "fake", mode: "read-write" },
      },
    }));

    const result = await runner.invoke("parent", "go", {
      context: ["app/user/u_123"],
    });

    expect(result.toolCalls[0].output).toMatchObject({
      mode: "read",
      grants: ["app/user/u_123"],
    });
  });
});
