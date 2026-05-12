import { describe, it, expect } from "vitest";
import { redactSkillToolResults } from "../src/session-redact.js";
import type { Message, ToolCallRecord } from "@agntz/core";

function makeToolCall(overrides: Partial<ToolCallRecord> & { id: string; name: string }): ToolCallRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    input: overrides.input ?? {},
    output: overrides.output ?? null,
    duration: overrides.duration ?? 10,
    error: overrides.error,
  };
}

describe("redactSkillToolResults", () => {
  it("replaces use_skill instructions with the placeholder, preserves name/description", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "do research",
        timestamp: "2026-05-12T10:00:00Z",
      },
      {
        role: "assistant",
        content: "Here is what I found.",
        toolCalls: [
          makeToolCall({
            id: "tu_1",
            name: "use_skill",
            input: { skill: "researcher" },
            output: {
              name: "researcher",
              description: "Web research with citation.",
              instructions:
                "real content. Search broadly. Cite sources. Maybe a multi-line block.",
            },
          }),
          makeToolCall({
            id: "tu_2",
            name: "other_tool",
            input: { q: "test" },
            output: "untouched-output",
          }),
        ],
        timestamp: "2026-05-12T10:00:01Z",
      },
    ];

    const redacted = redactSkillToolResults(messages);

    expect(redacted).toHaveLength(2);
    expect(redacted[0]).toEqual(messages[0]); // user message untouched

    const assistantMsg = redacted[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("Here is what I found.");
    expect(assistantMsg.timestamp).toBe("2026-05-12T10:00:01Z");
    expect(assistantMsg.toolCalls).toHaveLength(2);

    // use_skill tool call: output's instructions is replaced; name/description preserved
    const useSkillCall = assistantMsg.toolCalls![0];
    expect(useSkillCall.id).toBe("tu_1");
    expect(useSkillCall.name).toBe("use_skill");
    expect(useSkillCall.input).toEqual({ skill: "researcher" });
    expect(useSkillCall.duration).toBe(10);
    const output = useSkillCall.output as {
      name: string;
      description: string;
      instructions: string;
    };
    expect(output.name).toBe("researcher");
    expect(output.description).toBe("Web research with citation.");
    expect(output.instructions).toBe(
      "[skill 'researcher' was loaded earlier — call use_skill('researcher') to re-load]",
    );

    // Other tool call is unchanged
    const otherCall = assistantMsg.toolCalls![1];
    expect(otherCall).toEqual(messages[1].toolCalls![1]);
  });

  it("returns the same array reference when there is nothing to redact", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "hi",
        timestamp: "2026-05-12T10:00:00Z",
      },
      {
        role: "assistant",
        content: "hello",
        toolCalls: [
          makeToolCall({ id: "tu_1", name: "other_tool", output: "x" }),
        ],
        timestamp: "2026-05-12T10:00:01Z",
      },
    ];

    const redacted = redactSkillToolResults(messages);
    // Implementation claims to return the input reference unchanged in this case.
    expect(redacted).toBe(messages);
  });

  it("returns the same reference when messages have no tool calls at all", () => {
    const messages: Message[] = [
      { role: "system", content: "sys", timestamp: "2026-05-12T10:00:00Z" },
      { role: "user", content: "hi", timestamp: "2026-05-12T10:00:01Z" },
      { role: "assistant", content: "hello", timestamp: "2026-05-12T10:00:02Z" },
    ];
    const redacted = redactSkillToolResults(messages);
    expect(redacted).toBe(messages);
  });

  it("returns the same reference when a use_skill call has a non-skill-shaped output", () => {
    // E.g. an error result { ok: false, error: "..." } — no name/instructions
    // fields, so isSkillOutput returns false and the call is left alone.
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          makeToolCall({
            id: "tu_1",
            name: "use_skill",
            input: { skill: "missing" },
            output: { ok: false, error: 'skill "missing" not found' },
          }),
        ],
        timestamp: "2026-05-12T10:00:00Z",
      },
    ];
    const redacted = redactSkillToolResults(messages);
    expect(redacted).toBe(messages);
  });

  it("redacts multiple use_skill calls across multiple messages", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          makeToolCall({
            id: "tu_1",
            name: "use_skill",
            output: {
              name: "researcher",
              description: "d1",
              instructions: "content1",
            },
          }),
        ],
        timestamp: "2026-05-12T10:00:00Z",
      },
      { role: "user", content: "more", timestamp: "2026-05-12T10:00:01Z" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          makeToolCall({
            id: "tu_2",
            name: "use_skill",
            output: {
              name: "summarizer",
              description: "d2",
              instructions: "content2",
            },
          }),
        ],
        timestamp: "2026-05-12T10:00:02Z",
      },
    ];

    const redacted = redactSkillToolResults(messages);
    expect(redacted).not.toBe(messages);
    expect(redacted).toHaveLength(3);

    const first = (redacted[0].toolCalls![0].output as { instructions: string });
    const second = (redacted[2].toolCalls![0].output as { instructions: string });
    expect(first.instructions).toBe(
      "[skill 'researcher' was loaded earlier — call use_skill('researcher') to re-load]",
    );
    expect(second.instructions).toBe(
      "[skill 'summarizer' was loaded earlier — call use_skill('summarizer') to re-load]",
    );

    // Middle user message is the same reference.
    expect(redacted[1]).toBe(messages[1]);
  });

  it("does not mutate the input messages", () => {
    const originalOutput = {
      name: "researcher",
      description: "d",
      instructions: "real content",
    };
    const messages: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          makeToolCall({
            id: "tu_1",
            name: "use_skill",
            output: originalOutput,
          }),
        ],
        timestamp: "2026-05-12T10:00:00Z",
      },
    ];

    redactSkillToolResults(messages);

    // Input retained its original output object intact.
    expect(messages[0].toolCalls![0].output).toBe(originalOutput);
    expect((messages[0].toolCalls![0].output as { instructions: string }).instructions).toBe(
      "real content",
    );
  });
});
