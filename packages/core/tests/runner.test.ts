import { describe, it, expect, vi } from "vitest";
import { createRunner } from "../src/runner.js";
import { defineAgent } from "../src/agent.js";
import { defineTool } from "../src/tool.js";
import { z } from "zod";
import type { ModelProvider, GenerateTextOptions, GenerateTextResult } from "../src/types.js";

/**
 * Mock model provider that returns deterministic responses.
 * Used for testing the runner without making real API calls.
 */
class MockModelProvider implements ModelProvider {
  private responses: GenerateTextResult[];
  private callIndex = 0;
  public calls: GenerateTextOptions[] = [];

  constructor(responses: GenerateTextResult | GenerateTextResult[]) {
    this.responses = Array.isArray(responses) ? responses : [responses];
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    this.calls.push(options);
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

describe("Runner", () => {
  it("creates a runner with defaults", () => {
    const runner = createRunner();
    expect(runner).toBeDefined();
    expect(runner.tools.list()).toEqual([]);
  });

  it("registers and invokes an agent", async () => {
    const provider = new MockModelProvider(mockResponse("Hello from the agent!"));

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "greeter",
        name: "Greeter",
        systemPrompt: "You are a friendly greeter.",
        model: { provider: "openai", name: "gpt-5.4-mini" },
      })
    );

    const result = await runner.invoke("greeter", "Hi there!");

    expect(result.output).toBe("Hello from the agent!");
    expect(result.invocationId).toBeDefined();
    expect(result.model).toBe("openai/gpt-5.4-mini");
    expect(result.usage.totalTokens).toBe(30);
    expect(result.duration).toBeGreaterThanOrEqual(0);

    // Verify the messages sent to the model
    expect(provider.calls).toHaveLength(1);
    const call = provider.calls[0];
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toBe("You are a friendly greeter.");
    expect(call.messages[1].role).toBe("user");
    expect(call.messages[1].content).toBe("Hi there!");
  });

  it("throws for unknown agent", async () => {
    const runner = createRunner({
      modelProvider: new MockModelProvider(mockResponse("")),
    });

    await expect(runner.invoke("nonexistent", "hi")).rejects.toThrow(
      'Agent "nonexistent" not found'
    );
  });

  it("supports session continuity", async () => {
    const provider = new MockModelProvider([
      mockResponse("First response"),
      mockResponse("Second response"),
    ]);

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "chat",
        name: "Chat",
        systemPrompt: "You are a chat agent.",
        model: { provider: "openai", name: "gpt-5.4" },
      })
    );

    // First message
    await runner.invoke("chat", "Hello", { sessionId: "sess_1" });

    // Second message — should include history
    await runner.invoke("chat", "Follow up", { sessionId: "sess_1" });

    // The second call should have history in messages
    const secondCall = provider.calls[1];
    // system + user("Hello") + assistant("First response") + user("Follow up")
    expect(secondCall.messages.length).toBeGreaterThan(2);
  });

  it("handles tools in the invoke loop", async () => {
    const provider = new MockModelProvider([
      // First call: model wants to use a tool
      {
        text: "",
        toolCalls: [{
          id: "call_1",
          name: "get_time",
          args: {},
        }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "tool-calls",
      },
      // Second call: model gives final answer
      mockResponse("The current time is 10:42 PM."),
    ]);

    const getTime = defineTool({
      name: "get_time",
      description: "Get the current time",
      input: z.object({}),
      async execute() {
        return { time: "10:42 PM" };
      },
    });

    const runner = createRunner({
      modelProvider: provider,
      tools: [getTime],
    });

    runner.registerAgent(
      defineAgent({
        id: "time-agent",
        name: "Time Agent",
        systemPrompt: "You tell people the time.",
        model: { provider: "openai", name: "gpt-5.4" },
        tools: [{ type: "inline", name: "get_time" }],
      })
    );

    const result = await runner.invoke("time-agent", "What time is it?");

    expect(result.output).toBe("The current time is 10:42 PM.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("get_time");
    expect(result.toolCalls[0].output).toEqual({ time: "10:42 PM" });
    expect(result.usage.totalTokens).toBe(45); // 15 + 30
    expect(provider.calls).toHaveLength(2);
  });

  it("passes toolContext to tool execute", async () => {
    const capturedCtx: Record<string, unknown> = {};

    const provider = new MockModelProvider([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "ctx_tool", args: {} }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "tool-calls",
      },
      mockResponse("Done"),
    ]);

    const ctxTool = defineTool({
      name: "ctx_tool",
      description: "Captures context",
      input: z.object({}),
      async execute(_input, ctx) {
        capturedCtx.agentId = ctx.agentId;
        capturedCtx.userId = ctx.userId;
        capturedCtx.sessionId = ctx.sessionId;
        return { ok: true };
      },
    });

    const runner = createRunner({
      modelProvider: provider,
      tools: [ctxTool],
    });

    runner.registerAgent(
      defineAgent({
        id: "ctx-agent",
        name: "Ctx Agent",
        systemPrompt: "test",
        model: { provider: "openai", name: "gpt-5.4" },
        tools: [{ type: "inline", name: "ctx_tool" }],
      })
    );

    await runner.invoke("ctx-agent", "test", {
      sessionId: "sess_abc",
      toolContext: { userId: "user_123" },
    });

    expect(capturedCtx.agentId).toBe("ctx-agent");
    expect(capturedCtx.userId).toBe("user_123");
    expect(capturedCtx.sessionId).toBe("sess_abc");
  });

  it("registers inline tools at runner creation", () => {
    const tool = defineTool({
      name: "my-tool",
      description: "A tool",
      input: z.object({}),
      async execute() { return {}; },
    });

    const runner = createRunner({
      modelProvider: new MockModelProvider(mockResponse("")),
      tools: [tool],
    });

    const tools = runner.tools.list();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("my-tool");
  });

  it("injects context into messages", async () => {
    const provider = new MockModelProvider(mockResponse("Based on the research..."));

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "writer",
        name: "Writer",
        systemPrompt: "Write articles.",
        model: { provider: "openai", name: "gpt-5.4" },
      })
    );

    // Pre-populate context
    await runner.context.add("research", {
      agentId: "researcher",
      invocationId: "inv_001",
      content: "MCP is a protocol for tool integration.",
      createdAt: "2026-01-01T00:00:00Z",
    });

    await runner.invoke("writer", "Write about MCP", {
      contextIds: ["research"],
    });

    // Check that context was injected into the system prompt
    const systemMsg = provider.calls[0].messages[0];
    expect(systemMsg.content).toContain('<context id="research">');
    expect(systemMsg.content).toContain("MCP is a protocol");
  });

  it("resolves agent-as-tool references", async () => {
    // Two-step: researcher model returns result, writer model uses it
    const provider = new MockModelProvider([
      // Writer's first call — wants to invoke researcher
      {
        text: "",
        toolCalls: [{
          id: "call_1",
          name: "invoke_researcher",
          args: { input: "Find info about TypeScript" },
        }],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "tool-calls",
      },
      // Researcher's response (called by the agent-tool)
      mockResponse("TypeScript is a typed superset of JavaScript."),
      // Writer's final response after getting research
      mockResponse("Article: TypeScript is a typed superset of JavaScript, created by Microsoft."),
    ]);

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "researcher",
        name: "Researcher",
        description: "Researches topics thoroughly",
        systemPrompt: "You research topics and return concise findings.",
        model: { provider: "openai", name: "gpt-5.4" },
      })
    );

    runner.registerAgent(
      defineAgent({
        id: "writer",
        name: "Writer",
        systemPrompt: "Write articles. Use the researcher to gather facts first.",
        model: { provider: "openai", name: "gpt-5.4" },
        tools: [{ type: "agent", agentId: "researcher" }],
      })
    );

    const result = await runner.invoke("writer", "Write about TypeScript");

    expect(result.output).toBe("Article: TypeScript is a typed superset of JavaScript, created by Microsoft.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("invoke_researcher");
    expect(result.toolCalls[0].output).toEqual({
      output: "TypeScript is a typed superset of JavaScript.",
      toolCalls: 0,
    });

    // Model was called 3 times: writer(1st) → researcher → writer(2nd)
    expect(provider.calls).toHaveLength(3);
  });

  it("agent-as-tool appears in resolved tools list", async () => {
    const provider = new MockModelProvider(mockResponse("test"));
    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "helper",
        name: "Helper",
        description: "A helpful assistant",
        systemPrompt: "Help people.",
        model: { provider: "openai", name: "gpt-5.4" },
      })
    );

    runner.registerAgent(
      defineAgent({
        id: "main",
        name: "Main",
        systemPrompt: "You can delegate to the helper.",
        model: { provider: "openai", name: "gpt-5.4" },
        tools: [{ type: "agent", agentId: "helper" }],
      })
    );

    // Invoke to trigger tool resolution
    await runner.invoke("main", "test");

    // The invoke_helper tool should now be in the registry
    const tools = runner.tools.list();
    const helperTool = tools.find(t => t.name === "invoke_helper");
    expect(helperTool).toBeDefined();
    expect(helperTool!.description).toContain("Helper");
  });

  it("passes outputSchema to model provider", async () => {
    const provider = new MockModelProvider(
      mockResponse('{"sentiment": "positive", "score": 0.95}')
    );

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "analyzer",
        name: "Sentiment Analyzer",
        systemPrompt: "Analyze the sentiment of the input text.",
        model: { provider: "openai", name: "gpt-5.4" },
        outputSchema: {
          type: "object",
          properties: {
            sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
            score: { type: "number" },
          },
          required: ["sentiment", "score"],
        },
      })
    );

    const result = await runner.invoke("analyzer", "I love this product!");

    expect(result.output).toBe('{"sentiment": "positive", "score": 0.95}');

    // Verify outputSchema was passed to the model provider
    expect(provider.calls[0].outputSchema).toBeDefined();
    expect(provider.calls[0].outputSchema!.name).toBe("analyzer_output");
    expect(provider.calls[0].outputSchema!.schema).toEqual({
      type: "object",
      properties: {
        sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
        score: { type: "number" },
      },
      required: ["sentiment", "score"],
    });
  });

  it("does not pass outputSchema when not defined on agent", async () => {
    const provider = new MockModelProvider(mockResponse("Hello!"));

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "basic",
        name: "Basic",
        systemPrompt: "Be basic.",
        model: { provider: "openai", name: "gpt-5.4" },
      })
    );

    await runner.invoke("basic", "Hi");
    expect(provider.calls[0].outputSchema).toBeUndefined();
  });

  it("writes output to context when contextWrite is enabled", async () => {
    const provider = new MockModelProvider(mockResponse("Here are my findings."));

    const runner = createRunner({ modelProvider: provider });

    runner.registerAgent(
      defineAgent({
        id: "researcher",
        name: "Researcher",
        systemPrompt: "Research topics.",
        model: { provider: "openai", name: "gpt-5.4" },
        contextWrite: true,
      })
    );

    await runner.invoke("researcher", "Find info about AI", {
      contextIds: ["project-x"],
    });

    const entries = await runner.context.get("project-x");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Here are my findings.");
    expect(entries[0].agentId).toBe("researcher");
  });

  it("normalizes multimodal ContentBlock[] input — URLs fetched, base64'd, persisted", async () => {
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // tiny JPEG header
    const expectedBase64 = Buffer.from(body).toString("base64");
    const customFetch = vi.fn(async () => {
      const headers = new Headers({
        "content-type": "image/jpeg",
        "content-length": String(body.byteLength),
      });
      return new Response(body, { status: 200, headers });
    });

    // Patch the global fetch for the runner's image-fetcher path.
    const realFetch = globalThis.fetch;
    globalThis.fetch = customFetch as unknown as typeof fetch;

    try {
      const provider = new MockModelProvider(mockResponse("That's a great pose!"));
      const runner = createRunner({ modelProvider: provider });

      runner.registerAgent(
        defineAgent({
          id: "trainer",
          name: "Trainer",
          systemPrompt: "You coach lifts from photos.",
          model: { provider: "anthropic", name: "claude-sonnet-4-6" },
        }),
      );

      const result = await runner.invoke("trainer", [
        { type: "text", text: "how's my form?" },
        { type: "image", url: "https://example.test/squat.jpg" },
      ]);

      // The image-fetcher resolved the URL once.
      expect(customFetch).toHaveBeenCalledTimes(1);

      // Messages handed to the model carry parts with base64 image data.
      expect(provider.calls).toHaveLength(1);
      const userMsg = provider.calls[0].messages.find((m) => m.role === "user");
      expect(userMsg).toBeDefined();
      const parts = userMsg!.content as unknown as Array<{
        type: string;
        text?: string;
        image?: string;
        mediaType?: string;
      }>;
      expect(Array.isArray(parts)).toBe(true);
      expect(parts[0]).toEqual({ type: "text", text: "how's my form?" });
      expect(parts[1]).toEqual({
        type: "image",
        image: expectedBase64,
        mediaType: "image/jpeg",
      });

      // Session was persisted with the normalized blocks.
      const stored = await runner.sessions.getMessages(result.sessionId);
      expect(stored).toHaveLength(2);
      const userStored = stored[0];
      expect(Array.isArray(userStored.content)).toBe(true);
      const blocks = userStored.content as Array<
        { type: "text"; text: string } | { type: "image"; base64: string; mediaType: string }
      >;
      expect(blocks[0]).toEqual({ type: "text", text: "how's my form?" });
      expect(blocks[1]).toEqual({
        type: "image",
        base64: expectedBase64,
        mediaType: "image/jpeg",
      });

      // Invocation log carries the normalized blocks too.
      const log = await runner.logs.getLog(result.invocationId);
      expect(log).not.toBeNull();
      expect(Array.isArray(log!.input)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
