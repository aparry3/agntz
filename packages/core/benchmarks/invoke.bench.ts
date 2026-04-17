/**
 * Performance benchmarks for agntz core operations.
 * Run: npx vitest bench packages/core/benchmarks/
 */
import { bench, describe } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { defineTool } from "../src/tool.js";
import { MemoryStore } from "../src/stores/memory.js";
import { JsonFileStore } from "../src/stores/json-file.js";
import type { ModelProvider, GenerateTextOptions } from "../src/types.js";
import { z } from "zod";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

// Mock model provider — instant responses, no network
function createFastMockProvider(): ModelProvider {
  return {
    generateText: async (_opts: GenerateTextOptions) => ({
      text: "Mock response for benchmarking purposes.",
      toolCalls: [],
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      finishReason: "stop",
    }),
  };
}

// Mock model that makes tool calls
function createToolCallingMockProvider(): ModelProvider {
  let callCount = 0;
  return {
    generateText: async (_opts: GenerateTextOptions) => {
      callCount++;
      if (callCount % 2 === 1) {
        // First call: make a tool call
        return {
          text: "",
          toolCalls: [{ id: `tc_${callCount}`, name: "get_time", args: {} }],
          usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
          finishReason: "tool_calls",
        };
      }
      // Second call: final response
      return {
        text: "The current time is 12:00 PM.",
        toolCalls: [],
        usage: { promptTokens: 80, completionTokens: 15, totalTokens: 95 },
        finishReason: "stop",
      };
    },
  };
}

const testAgent = defineAgent({
  id: "bench-agent",
  name: "Benchmark Agent",
  systemPrompt: "You are a helpful assistant for benchmarking.",
  model: { provider: "mock", name: "mock-model" },
});

const testAgentWithTools = defineAgent({
  id: "bench-tool-agent",
  name: "Benchmark Tool Agent",
  systemPrompt: "You are a helpful assistant. Use tools when needed.",
  model: { provider: "mock", name: "mock-model" },
  tools: [{ type: "inline" as const, name: "get_time" }],
});

const getTimeTool = defineTool({
  name: "get_time",
  description: "Get the current time",
  input: z.object({}),
  async execute() {
    return { time: "12:00 PM" };
  },
});

describe("invoke() — no tools, MemoryStore", () => {
  const runner = createRunner({ modelProvider: createFastMockProvider() });
  runner.registerAgent(testAgent);

  bench("simple invoke", async () => {
    await runner.invoke("bench-agent", "Hello, world!");
  });
});

describe("invoke() — with session, MemoryStore", () => {
  const runner = createRunner({ modelProvider: createFastMockProvider() });
  runner.registerAgent(testAgent);

  bench("invoke with session", async () => {
    await runner.invoke("bench-agent", "Hello!", {
      sessionId: "bench-session-1",
    });
  });
});

describe("invoke() — with tool calls, MemoryStore", () => {
  bench("invoke with 1 tool call round-trip", async () => {
    // Create fresh provider each time since it tracks call count
    const runner = createRunner({
      modelProvider: createToolCallingMockProvider(),
      tools: [getTimeTool],
    });
    runner.registerAgent(testAgentWithTools);
    await runner.invoke("bench-tool-agent", "What time is it?");
  });
});

describe("invoke() — with context, MemoryStore", () => {
  const runner = createRunner({ modelProvider: createFastMockProvider() });
  runner.registerAgent(testAgent);

  // Pre-populate context
  (async () => {
    for (let i = 0; i < 10; i++) {
      await runner.context.add("bench-ctx", {
        agentId: "setup",
        invocationId: `setup_${i}`,
        content: `Context entry ${i} with some meaningful content about the project.`,
        createdAt: new Date().toISOString(),
      });
    }
  })();

  bench("invoke with context (10 entries)", async () => {
    await runner.invoke("bench-agent", "Summarize the context.", {
      contextIds: ["bench-ctx"],
    });
  });
});

describe("invoke() — JsonFileStore", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "agntz-bench-"));

  bench(
    "invoke with JsonFileStore",
    async () => {
      const runner = createRunner({
        modelProvider: createFastMockProvider(),
        store: new JsonFileStore(tempDir),
      });
      runner.registerAgent(testAgent);
      await runner.invoke("bench-agent", "Hello!");
    },
    {
      teardown: () => {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      },
    }
  );
});

describe("ToolRegistry — lookup performance", () => {
  const runner = createRunner({ modelProvider: createFastMockProvider() });

  // Register many tools
  for (let i = 0; i < 100; i++) {
    runner.registerTool(
      defineTool({
        name: `tool_${i}`,
        description: `Tool number ${i}`,
        input: z.object({ x: z.number() }),
        async execute(input) {
          return { result: input.x * 2 };
        },
      })
    );
  }

  bench("list 100 tools", () => {
    runner.tools.list();
  });

  bench("get tool by name", () => {
    runner.tools.get("tool_50");
  });
});

describe("Agent registration + resolution", () => {
  const runner = createRunner({ modelProvider: createFastMockProvider() });

  // Register many agents
  for (let i = 0; i < 100; i++) {
    runner.registerAgent(
      defineAgent({
        id: `agent-${i}`,
        name: `Agent ${i}`,
        systemPrompt: `You are agent ${i}.`,
        model: { provider: "mock", name: "mock" },
      })
    );
  }

  bench("invoke agent from 100 registered", async () => {
    await runner.invoke("agent-50", "Hello!");
  });
});
