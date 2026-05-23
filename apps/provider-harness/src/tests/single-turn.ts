import { AISDKModelProvider } from '@agntz/core';
import type { TestDefinition } from '../types.js';

const provider = new AISDKModelProvider();

export const singleTurnText: TestDefinition = {
  id: 'single-turn-text',
  capability: 'text',
  async run(model, ctx) {
    const result = await provider.generateText({
      model: { provider: model.provider, name: model.model },
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      // Generous to accommodate reasoning models that burn tokens on internal
      // thinking before emitting visible text. Still cheap per call.
      maxTokens: 256,
      signal: ctx.abortSignal,
    });

    if (typeof result.text !== 'string' || result.text.trim().length === 0) {
      return { ok: false, reason: `expected non-empty text, got: ${JSON.stringify(result.text)}` };
    }
    return { ok: true };
  },
};
