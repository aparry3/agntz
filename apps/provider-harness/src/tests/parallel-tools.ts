import type { TestDefinition } from '../types.js';
import { WEATHER_TOOL, modelConfig, provider } from './_helpers.js';

export const parallelTools: TestDefinition = {
  id: 'parallel-tools',
  capability: 'parallelTools',
  timeoutMs: 60_000,
  async run(model, ctx) {
    const result = await provider.generateText({
      model: modelConfig(model),
      messages: [
        {
          role: 'user',
          content:
            'Get the current weather for BOTH Paris and Tokyo. Call get_weather once for each city in this turn.',
        },
      ],
      tools: [WEATHER_TOOL],
      maxTokens: 1024,
      signal: ctx.abortSignal,
    });

    if (!result.toolCalls || result.toolCalls.length === 0) {
      return {
        ok: false,
        reason: `expected tool calls, got none (finishReason: ${result.finishReason})`,
      };
    }
    if (result.toolCalls.length < 2) {
      return {
        ok: false,
        reason: `expected >=2 parallel tool calls in one turn, got ${result.toolCalls.length}`,
      };
    }
    for (const tc of result.toolCalls) {
      if (tc.name !== WEATHER_TOOL.name) {
        return { ok: false, reason: `unexpected tool name "${tc.name}" among parallel calls` };
      }
    }
    return { ok: true };
  },
};
