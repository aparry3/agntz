import type { TestDefinition } from '../types.js';
import { assertNonEmptyText, modelConfig, provider } from './_helpers.js';

export const singleTurnText: TestDefinition = {
  id: 'single-turn-text',
  capability: 'text',
  async run(model, ctx) {
    const result = await provider.generateText({
      model: modelConfig(model),
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      // Generous to accommodate reasoning models that burn tokens on internal
      // thinking before emitting visible text. Still cheap per call.
      maxTokens: 256,
      signal: ctx.abortSignal,
    });
    return assertNonEmptyText(result.text);
  },
};
