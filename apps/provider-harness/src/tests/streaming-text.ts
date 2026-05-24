import type { TestDefinition } from '../types.js';
import { consumeStream, modelConfig, provider } from './_helpers.js';

export const streamingText: TestDefinition = {
  id: 'streaming-text',
  capability: 'streaming',
  async run(model, ctx) {
    const stream = await provider.streamText({
      model: modelConfig(model),
      messages: [{ role: 'user', content: 'Count from 1 to 3. One number per line.' }],
      maxTokens: 512,
      signal: ctx.abortSignal,
    });

    const consumed = await consumeStream(stream);

    if (consumed.streamError) throw consumed.streamError;
    if (!consumed.finishReason) {
      return { ok: false, reason: 'no finishReason resolved after stream completion' };
    }
    if (typeof consumed.usage?.promptTokens !== 'number') {
      return { ok: false, reason: `usage shape invalid: ${JSON.stringify(consumed.usage)}` };
    }
    if (consumed.text.trim().length === 0) {
      return {
        ok: false,
        reason: `no text streamed (chunks: ${consumed.chunks}, finishReason: ${consumed.finishReason})`,
      };
    }
    return { ok: true };
  },
};
