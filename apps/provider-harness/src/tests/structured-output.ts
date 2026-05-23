import type { TestDefinition } from '../types.js';
import { modelConfig, provider } from './_helpers.js';

export const structuredOutput: TestDefinition = {
  id: 'structured-output',
  capability: 'structuredOutput',
  timeoutMs: 60_000,
  async run(model, ctx) {
    const result = await provider.generateText({
      model: modelConfig(model),
      messages: [
        // The literal word "json" is required by some providers (e.g. Qwen,
        // OpenAI-compatible json_object mode) to enable structured output.
        { role: 'user', content: 'Return a person record for Alice, who is 30 years old, as JSON.' },
      ],
      outputSchema: {
        name: 'person',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
          required: ['name', 'age'],
          additionalProperties: false,
        },
      },
      maxTokens: 256,
      signal: ctx.abortSignal,
    });

    if (typeof result.text !== 'string' || result.text.trim().length === 0) {
      return { ok: false, reason: 'no text returned for structured output' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      return { ok: false, reason: `output is not valid JSON: ${result.text.slice(0, 120)}` };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, reason: `expected a JSON object, got ${typeof parsed}` };
    }
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.name !== 'string' || typeof obj.age !== 'number') {
      return { ok: false, reason: `schema not satisfied: ${JSON.stringify(parsed).slice(0, 120)}` };
    }
    return { ok: true };
  },
};
