import { describe, it, expect } from "vitest";
import { parseManifest } from "../src/parser.js";

describe("parseManifest", () => {
  it("parses a simple LLM agent", () => {
    const yaml = `
id: chatbot
name: Simple Chatbot
kind: llm
model:
  provider: openai
  name: gpt-4o
instruction: "Answer the question: {{userQuery}}"
`;
    const manifest = parseManifest(yaml);
    expect(manifest.kind).toBe("llm");
    expect(manifest.id).toBe("chatbot");
    if (manifest.kind === "llm") {
      expect(manifest.model.provider).toBe("openai");
      expect(manifest.model.name).toBe("gpt-4o");
      expect(manifest.instruction).toBe("Answer the question: {{userQuery}}");
    }
  });

  it("parses an LLM agent with tools", () => {
    const yaml = `
id: researcher
kind: llm
model:
  provider: openai
  name: gpt-4o
instruction: "Research this"
tools:
  - kind: mcp
    server: https://mcp.example.com
    tools:
      - toolA
      - tool: search
        name: search_user
        params:
          user_id: "{{userId}}"
  - kind: local
    tools: [calc]
  - kind: agent
    agent: helper
`;
    const manifest = parseManifest(yaml);
    if (manifest.kind === "llm") {
      expect(manifest.tools).toHaveLength(3);
      const mcp = manifest.tools![0];
      expect(mcp.kind).toBe("mcp");
      if (mcp.kind === "mcp") {
        expect(mcp.tools).toHaveLength(2);
        expect(mcp.tools![0]).toBe("toolA");
        const wrapped = mcp.tools![1];
        expect(typeof wrapped).toBe("object");
        if (typeof wrapped === "object") {
          expect(wrapped.tool).toBe("search");
          expect(wrapped.name).toBe("search_user");
          expect(wrapped.params).toEqual({ user_id: "{{userId}}" });
        }
      }
    }
  });

  it("parses a tool agent", () => {
    const yaml = `
id: send-email
kind: tool
tool:
  kind: mcp
  server: https://mcp.example.com
  name: send_email
  params:
    to: "{{recipient}}"
`;
    const manifest = parseManifest(yaml);
    expect(manifest.kind).toBe("tool");
    if (manifest.kind === "tool") {
      expect(manifest.tool.name).toBe("send_email");
      expect(manifest.tool.params).toEqual({ to: "{{recipient}}" });
    }
  });

  it("parses a sequential agent with ref steps", () => {
    const yaml = `
id: pipeline
kind: sequential
steps:
  - ref: researcher
    input:
      query: "{{userQuery}}"
  - ref: formatter
    input:
      content: "{{researcher}}"
    stateKey: final
output:
  result: "{{final}}"
`;
    const manifest = parseManifest(yaml);
    expect(manifest.kind).toBe("sequential");
    if (manifest.kind === "sequential") {
      expect(manifest.steps).toHaveLength(2);
      expect(manifest.steps[0].ref).toBe("researcher");
      expect(manifest.steps[1].stateKey).toBe("final");
      expect(manifest.output).toEqual({ result: "{{final}}" });
    }
  });

  it("parses a sequential agent with until (loop)", () => {
    const yaml = `
id: review-loop
kind: sequential
until: "{{reviewer.approved}} == true"
maxIterations: 5
steps:
  - ref: writer
  - ref: reviewer
`;
    const manifest = parseManifest(yaml);
    if (manifest.kind === "sequential") {
      expect(manifest.until).toBe("{{reviewer.approved}} == true");
      expect(manifest.maxIterations).toBe(5);
    }
  });

  it("parses a parallel agent with ref branches", () => {
    const yaml = `
id: analyze
kind: parallel
branches:
  - ref: sentiment
    input:
      text: "{{text}}"
  - ref: entities
    input:
      text: "{{text}}"
`;
    const manifest = parseManifest(yaml);
    expect(manifest.kind).toBe("parallel");
    if (manifest.kind === "parallel") {
      expect(manifest.branches).toHaveLength(2);
      expect(manifest.branches[0].ref).toBe("sentiment");
      expect(manifest.branches[1].ref).toBe("entities");
    }
  });

  it("parses inline agent definitions in steps", () => {
    const yaml = `
id: pipeline
kind: sequential
steps:
  - agent:
      id: inline-llm
      kind: llm
      model:
        provider: openai
        name: gpt-4o
      instruction: "Summarize: {{data}}"
      stateKey: summarizer
`;
    const manifest = parseManifest(yaml);
    if (manifest.kind === "sequential") {
      const step = manifest.steps[0];
      expect(step.agent).toBeDefined();
      expect(step.ref).toBeUndefined();
      expect(step.agent!.kind).toBe("llm");
      expect(step.agent!.id).toBe("inline-llm");
    }
  });

  it("throws on missing kind", () => {
    expect(() => parseManifest("id: test")).toThrow("kind");
  });

  it("throws on unknown kind", () => {
    expect(() => parseManifest("id: test\nkind: unknown")).toThrow("Unknown agent kind");
  });

  it("throws on step with neither ref nor agent", () => {
    const yaml = `
id: pipeline
kind: sequential
steps:
  - input:
      x: "{{y}}"
`;
    expect(() => parseManifest(yaml)).toThrow("ref");
  });
});
