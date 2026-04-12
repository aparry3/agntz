import { describe, it, expect, vi } from "vitest";
import { execute } from "../src/executor.js";
import type { AgentManifest, ExecutionContext, LLMAgentManifest } from "../src/types.js";

function createMockCtx(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    resolveAgent: vi.fn(),
    invokeLLM: vi.fn().mockResolvedValue("llm output"),
    invokeTool: vi.fn().mockResolvedValue("tool output"),
    ...overrides,
  };
}

describe("execute - LLM agent", () => {
  it("executes an LLM agent with template rendering", async () => {
    const manifest: LLMAgentManifest = {
      id: "test",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Answer: {{userQuery}}",
    };

    const ctx = createMockCtx({
      invokeLLM: vi.fn().mockResolvedValue("42"),
    });

    const result = await execute(manifest, "What is 2+2?", ctx);
    expect(result.output).toBe("42");
    expect(ctx.invokeLLM).toHaveBeenCalledWith(
      manifest,
      "Answer: What is 2+2?",
      { userQuery: "What is 2+2?" }
    );
  });
});

describe("execute - Tool agent", () => {
  it("executes a tool agent with param interpolation", async () => {
    const manifest: AgentManifest = {
      id: "send",
      kind: "tool",
      inputSchema: { to: "string", body: "string" },
      tool: {
        kind: "local",
        name: "send_email",
        params: { to: "{{to}}", body: "{{body}}" },
      },
    };

    const ctx = createMockCtx({
      invokeTool: vi.fn().mockResolvedValue({ sent: true }),
    });

    const result = await execute(manifest, { to: "a@b.com", body: "hello" }, ctx);
    expect(result.output).toEqual({ sent: true });
    expect(ctx.invokeTool).toHaveBeenCalledWith(
      { kind: "local", name: "send_email", params: { to: "a@b.com", body: "hello" } },
      { to: "a@b.com", body: "hello" }
    );
  });
});

describe("execute - Sequential agent", () => {
  it("runs steps in order with state flow", async () => {
    const agentA: LLMAgentManifest = {
      id: "agent-a",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Do A",
    };
    const agentB: LLMAgentManifest = {
      id: "agent-b",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Do B with {{data}}",
    };

    const manifest: AgentManifest = {
      id: "pipeline",
      kind: "sequential",
      steps: [
        { agent: "agent-a" },
        {
          agent: "agent-b",
          input: { data: "{{agentA}}" },
        },
      ],
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockImplementation((id: string) => {
        if (id === "agent-a") return Promise.resolve(agentA);
        if (id === "agent-b") return Promise.resolve(agentB);
        throw new Error(`Unknown agent: ${id}`);
      }),
      invokeLLM: vi
        .fn()
        .mockResolvedValueOnce("result-a")
        .mockResolvedValueOnce("result-b"),
    });

    const result = await execute(manifest, "go", ctx);
    // Default output: last step's output
    expect(result.output).toBe("result-b");
    // State should have both outputs
    expect(result.state.agentA).toBe("result-a");
    expect(result.state.agentB).toBe("result-b");
  });

  it("skips steps with false when condition", async () => {
    const agentA: LLMAgentManifest = {
      id: "agent-a",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Do A",
    };

    const manifest: AgentManifest = {
      id: "pipeline",
      kind: "sequential",
      steps: [
        {
          agent: "agent-a",
          when: "{{shouldRun}}",
        },
      ],
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockResolvedValue(agentA),
    });

    const result = await execute(manifest, "go", ctx);
    expect(result.state.agentA).toBeNull();
    expect(ctx.invokeLLM).not.toHaveBeenCalled();
  });

  it("applies output mapping", async () => {
    const agentA: LLMAgentManifest = {
      id: "agent-a",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Do A",
    };

    const manifest: AgentManifest = {
      id: "pipeline",
      kind: "sequential",
      steps: [{ agent: "agent-a" }],
      output: { final: "{{agentA}}" },
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockResolvedValue(agentA),
      invokeLLM: vi.fn().mockResolvedValue("done"),
    });

    const result = await execute(manifest, "go", ctx);
    expect(result.output).toEqual({ final: "done" });
  });
});

describe("execute - Sequential with loop", () => {
  it("loops until condition is met", async () => {
    let iteration = 0;
    const writer: LLMAgentManifest = {
      id: "writer",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Write",
    };
    const reviewer: LLMAgentManifest = {
      id: "reviewer",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Review",
      outputSchema: { approved: "boolean", feedback: "string" },
    };

    const manifest: AgentManifest = {
      id: "loop",
      kind: "sequential",
      until: "{{reviewer.approved}} == true",
      maxIterations: 10,
      steps: [
        { agent: "writer" },
        { agent: "reviewer" },
      ],
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockImplementation((id: string) => {
        if (id === "writer") return Promise.resolve(writer);
        if (id === "reviewer") return Promise.resolve(reviewer);
        throw new Error(`Unknown: ${id}`);
      }),
      invokeLLM: vi.fn().mockImplementation(() => {
        iteration++;
        if (iteration % 2 === 1) return Promise.resolve("draft");
        // Reviewer approves on 2nd iteration (iteration 4)
        return Promise.resolve({ approved: iteration >= 4, feedback: "try again" });
      }),
    });

    const result = await execute(manifest, "topic", ctx);
    expect(iteration).toBe(4); // 2 iterations * 2 steps
    expect(result.state.reviewer).toEqual({ approved: true, feedback: "try again" });
  });

  it("respects maxIterations", async () => {
    const agent: LLMAgentManifest = {
      id: "agent",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "Do",
    };

    const manifest: AgentManifest = {
      id: "loop",
      kind: "sequential",
      until: "{{never}} == true",
      maxIterations: 3,
      steps: [{ agent: "agent" }],
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockResolvedValue(agent),
      invokeLLM: vi.fn().mockResolvedValue("result"),
    });

    await execute(manifest, "go", ctx);
    expect(ctx.invokeLLM).toHaveBeenCalledTimes(3);
  });
});

describe("execute - Parallel agent", () => {
  it("runs branches concurrently", async () => {
    const agentA: LLMAgentManifest = {
      id: "agent-a",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "A",
    };
    const agentB: LLMAgentManifest = {
      id: "agent-b",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "B",
    };

    const manifest: AgentManifest = {
      id: "parallel",
      kind: "parallel",
      branches: [
        { agent: "agent-a", input: { text: "{{userQuery}}" } },
        { agent: "agent-b", input: { text: "{{userQuery}}" } },
      ],
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockImplementation((id: string) => {
        if (id === "agent-a") return Promise.resolve(agentA);
        if (id === "agent-b") return Promise.resolve(agentB);
        throw new Error(`Unknown: ${id}`);
      }),
      invokeLLM: vi
        .fn()
        .mockResolvedValueOnce("result-a")
        .mockResolvedValueOnce("result-b"),
    });

    const result = await execute(manifest, "input", ctx);
    // Default output: all branch outputs as object
    expect(result.output).toEqual({
      agentA: "result-a",
      agentB: "result-b",
    });
  });

  it("applies output mapping", async () => {
    const agentA: LLMAgentManifest = {
      id: "agent-a",
      kind: "llm",
      model: { provider: "openai", name: "gpt-4o" },
      instruction: "A",
    };

    const manifest: AgentManifest = {
      id: "parallel",
      kind: "parallel",
      branches: [{ agent: "agent-a" }],
      output: { result: "{{agentA}}" },
    };

    const ctx = createMockCtx({
      resolveAgent: vi.fn().mockResolvedValue(agentA),
      invokeLLM: vi.fn().mockResolvedValue("done"),
    });

    const result = await execute(manifest, "go", ctx);
    expect(result.output).toEqual({ result: "done" });
  });
});
