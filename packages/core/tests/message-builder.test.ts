import { describe, it, expect } from "vitest";
import {
  buildMessages,
  contentBlocksToAiSdkParts,
  flattenContentToText,
  messageContentToAiSdk,
} from "../src/message-builder.js";
import type { AgentDefinition, ContentBlock, Message } from "../src/types.js";

const baseAgent: AgentDefinition = {
  id: "test",
  name: "Test",
  systemPrompt: "You are a test agent.",
  model: { provider: "openai", name: "gpt-5.4" },
};

describe("buildMessages", () => {
  it("emits string content for plain-string input (legacy)", () => {
    const out = buildMessages({ agent: baseAgent, input: "hello" });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ role: "system", content: "You are a test agent." });
    expect(out[1]).toEqual({ role: "user", content: "hello" });
  });

  it("applies userPromptTemplate to a string input", () => {
    const agent = { ...baseAgent, userPromptTemplate: "Q: {{input}}" };
    const out = buildMessages({ agent, input: "what is 2+2?" });
    expect(out[1]).toEqual({ role: "user", content: "Q: what is 2+2?" });
  });

  it("emits AI SDK parts for ContentBlock[] input", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "what's in this image?" },
      { type: "image", base64: "QUFBQQ==", mediaType: "image/jpeg" },
    ];
    const out = buildMessages({ agent: baseAgent, input: blocks });
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe("user");
    expect(out[1].content).toEqual([
      { type: "text", text: "what's in this image?" },
      { type: "image", image: "QUFBQQ==", mediaType: "image/jpeg" },
    ]);
  });

  it("bypasses userPromptTemplate for ContentBlock[] input", () => {
    const agent = { ...baseAgent, userPromptTemplate: "Q: {{input}}" };
    const blocks: ContentBlock[] = [{ type: "text", text: "hi" }];
    const out = buildMessages({ agent, input: blocks });
    // No template substitution; the blocks pass through as parts.
    expect(out[1].content).toEqual([{ type: "text", text: "hi" }]);
  });

  it("preserves string history messages alongside multimodal current turn", () => {
    const now = new Date().toISOString();
    const history: Message[] = [
      { role: "user", content: "earlier text", timestamp: now },
      { role: "assistant", content: "earlier reply", timestamp: now },
    ];
    const blocks: ContentBlock[] = [
      { type: "text", text: "now multimodal" },
      { type: "image", base64: "AAAA", mediaType: "image/png" },
    ];
    const out = buildMessages({
      agent: baseAgent,
      input: blocks,
      sessionHistory: history,
    });
    // system + history(2) + user(multimodal)
    expect(out).toHaveLength(4);
    expect(out[1].content).toBe("earlier text");
    expect(out[2].content).toBe("earlier reply");
    expect(Array.isArray(out[3].content)).toBe(true);
  });

  it("translates ContentBlock[] session history into AI SDK parts", () => {
    const now = new Date().toISOString();
    const history: Message[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image", base64: "BBBB", mediaType: "image/webp" },
        ],
        timestamp: now,
      },
    ];
    const out = buildMessages({
      agent: baseAgent,
      input: "follow up",
      sessionHistory: history,
    });
    expect(Array.isArray(out[1].content)).toBe(true);
    expect(out[1].content).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", image: "BBBB", mediaType: "image/webp" },
    ]);
  });

  it("keeps [Conversation Summary] system messages from history (works with both content shapes)", () => {
    const now = new Date().toISOString();
    const history: Message[] = [
      {
        role: "system",
        content: "[Conversation Summary] some summary text",
        timestamp: now,
      },
      { role: "user", content: "next turn", timestamp: now },
    ];
    const out = buildMessages({
      agent: baseAgent,
      input: "more",
      sessionHistory: history,
    });
    // system(agent) + system(summary) + user(prev) + user(new)
    expect(out).toHaveLength(4);
    expect(out[1].role).toBe("system");
    expect(out[1].content).toBe("[Conversation Summary] some summary text");
  });
});

describe("contentBlocksToAiSdkParts", () => {
  it("maps text and image-base64 blocks", () => {
    const out = contentBlocksToAiSdkParts([
      { type: "text", text: "hi" },
      { type: "image", base64: "QUFBQQ==", mediaType: "image/jpeg" },
    ]);
    expect(out).toEqual([
      { type: "text", text: "hi" },
      { type: "image", image: "QUFBQQ==", mediaType: "image/jpeg" },
    ]);
  });

  it("degrades a stray image-with-url block to a text placeholder", () => {
    const out = contentBlocksToAiSdkParts([
      { type: "image", url: "https://example.test/img.jpg" },
    ]);
    expect(out).toEqual([{ type: "text", text: "[image: https://example.test/img.jpg]" }]);
  });
});

describe("flattenContentToText", () => {
  it("passes strings through", () => {
    expect(flattenContentToText("hello")).toBe("hello");
  });

  it("joins text blocks with spaces and replaces image blocks with placeholder", () => {
    expect(
      flattenContentToText([
        { type: "text", text: "look" },
        { type: "image", base64: "AAAA", mediaType: "image/png" },
        { type: "text", text: "here" },
      ]),
    ).toBe("look [image] here");
  });
});

describe("messageContentToAiSdk", () => {
  it("strings pass through", () => {
    expect(messageContentToAiSdk("plain")).toBe("plain");
  });

  it("ContentBlock[] is converted to parts", () => {
    expect(messageContentToAiSdk([{ type: "text", text: "x" }])).toEqual([
      { type: "text", text: "x" },
    ]);
  });
});
