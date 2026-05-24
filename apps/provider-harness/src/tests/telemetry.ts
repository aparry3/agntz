import type { TestDefinition } from '../types.js';
import { modelConfig, provider } from './_helpers.js';

export const telemetryShape: TestDefinition = {
  id: 'telemetry-shape',
  capability: 'text',
  async run(model, ctx) {
    const result = await provider.generateText({
      model: modelConfig(model),
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      maxTokens: 256,
      signal: ctx.abortSignal,
    });

    const u = result.usage;
    if (!u || typeof u !== 'object') {
      return { ok: false, reason: 'no usage object returned' };
    }
    if (typeof u.promptTokens !== 'number' || u.promptTokens < 0) {
      return { ok: false, reason: `promptTokens invalid: ${u.promptTokens}` };
    }
    if (typeof u.completionTokens !== 'number' || u.completionTokens < 0) {
      return { ok: false, reason: `completionTokens invalid: ${u.completionTokens}` };
    }
    if (typeof u.totalTokens !== 'number') {
      return { ok: false, reason: `totalTokens invalid: ${u.totalTokens}` };
    }
    if (typeof result.finishReason !== 'string' || result.finishReason.length === 0) {
      return { ok: false, reason: `finishReason invalid: ${JSON.stringify(result.finishReason)}` };
    }
    return { ok: true };
  },
};
