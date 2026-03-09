import { describe, it, expect } from "vitest";
import { createRunner, defineAgent, defineTool } from "../src/index.js";
import { MaxRecursionDepthError } from "../src/errors.js";
import { z } from "zod";

// Mock model provider that triggers tool calls for a certain number of rounds
function createMockModelProvider(toolCallRounds = 0) {
  let round = 0;
  return {
    async generateText(options: any) {
      round++;

      // If we have tools and haven't exceeded rounds, make a tool call
      if (options.tools?.length && round <= toolCallRounds) {
        return {
          text: "",
          toolCalls: [
            {
              id: `tc-${round}`,
              name: options.tools[0].name,
              args: { input: `Round ${round}` },
            },
          ],
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "tool-calls",
        };
      }

      return {
        text: `Response at round ${round}`,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "stop",
      };
    },
  };
}

describe("Recursion Depth", () => {
  it("should throw MaxRecursionDepthError when depth exceeds limit", async () => {
    // Create a model provider that always calls the sub-agent tool
    const provider = {
      async generateText(options: any) {
        if (options.tools?.length) {
          return {
            text: "",
            toolCalls: [
              {
                id: "tc-1",
                name: options.tools[0].name,
                args: { input: "recurse" },
              },
            ],
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            finishReason: "tool-calls",
          };
        }
        return {
          text: "Done",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          finishReason: "stop",
        };
      },
    };

    const runner = createRunner({
      modelProvider: provider,
      maxRecursionDepth: 2,
    });

    // Agent A calls Agent B which calls Agent A (circular)
    runner.registerAgent(
      defineAgent({
        id: "agent-a",
        name: "Agent A",
        systemPrompt: "Call agent B",
        model: { provider: "test", name: "test" },
        tools: [{ type: "agent", agentId: "agent-b" }],
      })
    );

    runner.registerAgent(
      defineAgent({
        id: "agent-b",
        name: "Agent B",
        systemPrompt: "Call agent A",
        model: { provider: "test", name: "test" },
        tools: [{ type: "agent", agentId: "agent-a" }],
      })
    );

    await expect(runner.invoke("agent-a", "start")).rejects.toThrow(
      MaxRecursionDepthError
    );
  });

  it("should allow agent chains within depth limit", async () => {
    const provider = createMockModelProvider(1);

    const runner = createRunner({
      modelProvider: provider,
      maxRecursionDepth: 5,
    });

    runner.registerAgent(
      defineAgent({
        id: "parent",
        name: "Parent",
        systemPrompt: "You are a parent agent",
        model: { provider: "test", name: "test" },
        tools: [{ type: "agent", agentId: "child" }],
      })
    );

    runner.registerAgent(
      defineAgent({
        id: "child",
        name: "Child",
        systemPrompt: "You are a child agent",
        model: { provider: "test", name: "test" },
      })
    );

    const result = await runner.invoke("parent", "delegate this");
    expect(result.output).toBeTruthy();
  });

  it("should default to depth 3", async () => {
    // Verify the default works without explicit config
    const provider = createMockModelProvider(0);
    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "simple",
        name: "Simple",
        systemPrompt: "test",
        model: { provider: "test", name: "test" },
      })
    );

    // Invoke with explicit depth at limit should throw
    await expect(
      runner.invoke("simple", "test", { _recursionDepth: 4 })
    ).rejects.toThrow(MaxRecursionDepthError);

    // Invoke within limit should work
    const result = await runner.invoke("simple", "test", { _recursionDepth: 2 });
    expect(result.output).toBeTruthy();
  });
});
