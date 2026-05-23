import type { TestDefinition } from '../types.js';
import { WEATHER_TOOL, consumeStream, modelConfig, provider } from './_helpers.js';

export const streamingTools: TestDefinition = {
  id: 'streaming-tools',
  capability: 'streamingTools',
  async run(model, ctx) {
    const stream = await provider.streamText({
      model: modelConfig(model),
      messages: [
        { role: 'user', content: 'What is the weather in Paris? Use the get_weather tool.' },
      ],
      tools: [WEATHER_TOOL],
      // Generous budget so reasoning models have room to think and still emit
      // the tool call rather than exhausting tokens mid-reasoning.
      maxTokens: 1024,
      signal: ctx.abortSignal,
    });

    const consumed = await consumeStream(stream);

    if (consumed.streamError) throw consumed.streamError;
    if (consumed.toolCalls.length === 0) {
      return {
        ok: false,
        reason: `expected >=1 tool call via stream, got 0 (finishReason: ${consumed.finishReason})`,
      };
    }
    const call = consumed.toolCalls[0];
    if (call.name !== WEATHER_TOOL.name) {
      return { ok: false, reason: `expected tool "${WEATHER_TOOL.name}", got "${call.name}"` };
    }
    return { ok: true };
  },
};
