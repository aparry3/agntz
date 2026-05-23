import type { TestDefinition } from '../types.js';
import { WEATHER_TOOL, modelConfig, provider } from './_helpers.js';

export const toolRoundtrip: TestDefinition = {
  id: 'tool-roundtrip',
  capability: 'tools',
  timeoutMs: 60_000,
  async run(model, ctx) {
    const mc = modelConfig(model);

    const firstMessages: Array<{ role: string; content: unknown }> = [
      { role: 'user', content: 'What is the weather in Paris? You must call the get_weather tool to find out.' },
    ];

    const first = await provider.generateText({
      model: mc,
      messages: firstMessages,
      tools: [WEATHER_TOOL],
      maxTokens: 1024,
      signal: ctx.abortSignal,
    });

    if (!first.toolCalls || first.toolCalls.length === 0) {
      return {
        ok: false,
        reason: `expected a tool call on turn 1, got none (finishReason: ${first.finishReason})`,
      };
    }
    const call = first.toolCalls[0];
    if (call.name !== WEATHER_TOOL.name) {
      return { ok: false, reason: `expected tool "${WEATHER_TOOL.name}", got "${call.name}"` };
    }

    // Reconstruct the next turn in the AI SDK canonical format — mirrors the
    // exact shape @agntz/core's runner builds (assistant tool-call parts +
    // role:'tool' tool-result parts, each carrying toolName). This is the
    // structure the original bug lived in, so it's what we snapshot.
    const followupMessages: Array<{ role: string; content: unknown }> = [
      ...firstMessages,
      {
        role: 'assistant',
        content: first.toolCalls.map((tc) => ({
          type: 'tool-call' as const,
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.args,
        })),
      },
      ...first.toolCalls.map((tc) => ({
        role: 'tool',
        content: [
          {
            type: 'tool-result' as const,
            toolCallId: tc.id,
            toolName: tc.name,
            output: { type: 'text' as const, value: '18°C and sunny' },
          },
        ],
      })),
    ];

    const second = await provider.generateText({
      model: mc,
      messages: followupMessages,
      tools: [WEATHER_TOOL],
      maxTokens: 1024,
      signal: ctx.abortSignal,
    });

    if (typeof second.text !== 'string' || second.text.trim().length === 0) {
      return {
        ok: false,
        reason: `expected final text after tool result, got empty (finishReason: ${second.finishReason})`,
      };
    }

    return {
      ok: true,
      snapshot: {
        normalizedToolCall: first.toolCalls,
        followupMessages,
      },
    };
  },
};
